import { after } from "next/server";
import { z } from "zod";
import { answerAsk, askPreCheck } from "@/lib/ai/ask";
import { aiMode } from "@/lib/ai/client";
import { ASK_LIMITS, ASK_TURN_KINDS, countsAgainstDay, type AskClearOk, type AskData, type AskPostOk } from "@/lib/ask/types";
import { sameOrigin } from "@/lib/auth/origin";
import { apiUser } from "@/lib/auth/session";
import type { PlanView } from "@/lib/domain/plan";
import {
  alertLine,
  askAlert,
  askCounters,
  askDailyMax,
  askFail,
  askGateError,
  askJson,
  askThread,
  claimAsk,
  cleanQuestion,
  clearAsks,
  completeAsk,
  dayFields,
  earlierTurns,
  errorClass,
  isLivePending,
  istDay,
  leftOf,
  loadAsk,
  releaseAsk,
  saveFreeTurn,
  turnByClientKey,
  turnView,
  type AskTurnRow,
} from "@/lib/platform/ask";
import { getProfile } from "@/lib/platform/profile";
import { allowRequest, clientIp } from "@/lib/waitlist/rate-limit";

// Ask: POST asks, GET reads today's thread, DELETE clears it ("Clear now"). The contract is
// docs/team/specs/2026-11-19-ask-build.md §3; the data and limits are lib/platform/ask.ts;
// the AI is lib/ai/ask.ts, reached only through askPreCheck and answerAsk.
//
// No caching anywhere: every reply is no-store, and nothing here uses a cache directive. Logs carry
// kinds, counts and timings, never the question, the answer, a marker or a meal.
// Node runtime in bom1 (vercel.json); Cache Components forbids a `runtime` export.

export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().min(1).max(100);
const askRequest = z.strictObject({
  clientKey: z.string().regex(UUID),
  question: z.string(),
  about: z
    .discriminatedUnion("type", [
      z.strictObject({ type: z.literal("marker"), id }),
      z.strictObject({ type: z.literal("meal"), id }),
      z.strictObject({ type: z.literal("stack_item"), nutrient: z.string().min(1).max(200) }),
      z.strictObject({ type: z.literal("gaps") }),
    ])
    .optional(),
});

const isJson = (request: Request) => (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() === "application/json";

/** The body as text, or null when it's over `max` bytes: by Content-Length first, then while reading. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const logLine = (o: { kind: string; counted: boolean; raised?: boolean; filter?: string | null; left: number; started: number; free?: boolean }) =>
  console.info(
    `[ask] kind=${o.kind} counted=${o.counted ? 1 : 0} raised=${o.raised ? 1 : 0} filter=${o.filter ?? "-"} left=${o.left} ms=${Date.now() - o.started}${o.free ? " free=1" : ""}`,
  );

export async function POST(request: Request) {
  const started = Date.now();
  // 1–3: cheap checks before anything is read about anyone.
  if (!sameOrigin(request)) return askFail("bad_origin");
  if (!isJson(request)) return askFail("bad_type");
  const body = await readCapped(request, ASK_LIMITS.bodyMaxBytes);
  if (body === null) return askFail("too_large");
  // 4–5: the person, and the speed bumps (the database caps are the real limits).
  const user = await apiUser();
  if (!user) return askFail("signed_out");
  const now = new Date();
  const day = istDay(now);
  const days = dayFields(day);
  if (
    !allowRequest(`ask:${user.id}`, ASK_LIMITS.burstPerPersonPerMinute, 60_000) ||
    !allowRequest(`ask-ip:${clientIp(request.headers)}`, ASK_LIMITS.burstPerIpPer10Minutes, 10 * 60_000)
  )
    return askFail("rate_limited", days);
  // 6–7: who may ask, and the one-time notice.
  const profile = await getProfile(user.id);
  const gate = askGateError(user, profile);
  if (gate || !profile) return askFail(gate ?? "not_onboarded", days);
  if (!profile.askConsentAt) return askFail("consent_needed", days);
  // 8: the shape, then the question cleaned (refused, never cut).
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return askFail("invalid", days);
  }
  const parsed = askRequest.safeParse(raw);
  if (!parsed.success) return askFail("invalid", days);
  const cleaned = cleanQuestion(parsed.data.question);
  if (!cleaned.ok) return askFail(cleaned.error, days);
  const question = cleaned.question;
  const clientKey = parsed.data.clientKey.toLowerCase();

  try {
    // 9: one parallel batch of their own data.
    const load = await loadAsk(user.id, profile, { now, clientKey, about: parsed.data.about, plan: true });
    const newestReportId = load.newest?.id ?? null;
    const left = leftOf(load.counters);
    const replay = (row: AskTurnRow) => {
      const turn = turnView(row, { newestReportId });
      return askJson({ kind: turn.kind, turn, left, ...days } satisfies AskPostOk);
    };

    // 10: the same question again: its saved turn, counting nothing; or still in flight.
    const same = load.turns.find((t) => t.clientKey === clientKey);
    if (same?.status === "answered") return replay(same);
    if (same && isLivePending(same, now)) return askFail("busy", { left, ...days });

    // 11: code's own replies (crisis, emergency, an urgent marker named) come before every
    // switch and limit, so they're answered even when Ask is off, paused or used up. Free.
    const data: AskData = { ...load.data, plan: load.plan as PlanView };
    const pre = askPreCheck({ question, about: load.about, data });
    if (pre) {
      const saved = await saveFreeTurn({ userId: user.id, clientKey, day, question, reportId: data.report?.id ?? null, reply: pre });
      if ("busy" in saved) return askFail("busy", { left, ...days });
      logLine({ kind: pre.kind, counted: false, raised: pre.floorRaised, filter: pre.filter, left, started, free: true });
      return replay(saved.turn);
    }

    // 12–13: the switches, then one question in flight (the claim checks again under the lock).
    const max = askDailyMax();
    if (aiMode() === "off" || max === 0) return askFail("ai_off", { left, ...days });
    if (load.turns.some((t) => t.clientKey !== clientKey && isLivePending(t, now))) return askFail("busy", { left, ...days });

    // 14: the claim.
    const claim = await claimAsk({ userId: user.id, clientKey, day, question, reportId: data.report?.id ?? null, max });
    if (!claim.ok) {
      switch (claim.reason) {
        case "limit":
          logLine({ kind: "limit", counted: false, left: 0, started });
          return askJson({ kind: "limit", turn: null, left: 0, ...days } satisfies AskPostOk);
        case "too_many_tries":
          return askFail("too_many_tries", { left: 0, ...days });
        case "paused":
          after(() => askAlert("cap", day, claim.everyone, max));
          return askFail("paused", { left, ...days });
        case "duplicate": {
          const row = await turnByClientKey(user.id, clientKey);
          return row?.status === "answered" ? replay(row) : askFail("busy", { left, ...days });
        }
        default:
          return askFail("busy", { left, ...days });
      }
    }
    // 17: the founders hear once a day when everyone's calls reach 80% of the limit.
    if (claim.everyone >= alertLine(max)) after(() => askAlert("80", day, claim.everyone, max));

    // 15–16: the model, then the answer saved; anything short of saved hands the question back.
    const handedBack = leftOf({ used: claim.used - 1, attempts: claim.attempts });
    let saved = false;
    try {
      const result = await answerAsk(
        { question, about: load.about, earlier: earlierTurns(load), data: { ...data, asksLeft: leftOf(claim) } },
        { signal: AbortSignal.timeout(ASK_LIMITS.aiDeadlineMs) },
      );
      if (!result.ok) {
        const code = result.error;
        console.info(`[ask] error=${code} left=${handedBack} ms=${Date.now() - started}`);
        return askFail(code, { left: handedBack, ...days });
      }
      const { reply, usage } = result;
      // The types promise a known kind; a stray one is our failure, handed back, never saved.
      if (!(ASK_TURN_KINDS as readonly string[]).includes(reply.kind)) throw new TypeError("unknown kind");
      const counted = countsAgainstDay(reply.kind);
      if (!(await completeAsk({ turnId: claim.turnId, userId: user.id, reply, usage, counted }))) {
        // A report delete reached the turn mid-answer: nothing was saved.
        console.info(`[ask] error=report_deleted left=${handedBack} ms=${Date.now() - started}`);
        return askFail("report_deleted", { left: handedBack, ...days });
      }
      saved = true;
      const leftNow = counted ? leftOf(claim) : handedBack;
      logLine({ kind: reply.kind, counted, raised: reply.floorRaised, filter: reply.filter, left: leftNow, started });
      const turn = turnView(
        {
          id: claim.turnId,
          userId: user.id,
          clientKey,
          day,
          status: "answered",
          kind: reply.kind,
          counted,
          question,
          answer: reply.answer,
          notice: reply.notice,
          links: reply.links,
          lang: reply.lang,
          reportId: data.report?.id ?? null,
          removedAt: null,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          ms: usage.ms,
          createdAt: claim.at,
          answeredAt: new Date(),
        },
        { newestReportId },
      );
      return askJson({ kind: reply.kind, turn, left: leftNow, ...days } satisfies AskPostOk);
    } catch (error) {
      console.error(`[ask] error=error class=${errorClass(error)} left=${handedBack}`);
      return askFail("error", { left: handedBack, ...days });
    } finally {
      if (!saved) await releaseAsk(claim.turnId, user.id).catch((error) => console.error(`[ask] release failed class=${errorClass(error)}`));
    }
  } catch (error) {
    console.error(`[ask] error=error class=${errorClass(error)}`);
    return askFail("error", days);
  }
}

export async function GET() {
  // The session first (it reads the cookie, so this runs at request time), outside the try:
  // nothing of Next's own may be caught.
  const user = await apiUser();
  if (!user) return askFail("signed_out");
  const now = new Date();
  const days = dayFields(istDay(now));
  if (!allowRequest(`ask-get:${user.id}`, ASK_LIMITS.getPerPersonPerMinute, 60_000)) return askFail("rate_limited", days);
  try {
    const profile = await getProfile(user.id);
    const gate = askGateError(user, profile);
    if (gate || !profile) return askFail(gate ?? "not_onboarded", days);
    const load = await loadAsk(user.id, profile, { now });
    const max = askDailyMax();
    const state = aiMode() === "off" || max === 0 ? "off" : load.everyone >= max ? "paused" : "ready";
    return askJson(askThread(load, profile, state));
  } catch (error) {
    console.error(`[ask] thread error class=${errorClass(error)}`);
    return askFail("error", days);
  }
}

/** "Clear now": the person's answered questions go; one in flight stays; questions already used still count. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return askFail("bad_origin");
  const user = await apiUser();
  if (!user) return askFail("signed_out");
  const day = istDay();
  const days = dayFields(day);
  try {
    const profile = await getProfile(user.id);
    const gate = askGateError(user, profile);
    if (gate) return askFail(gate, days);
    const [cleared, counters] = await Promise.all([clearAsks(user.id), askCounters(user.id, day)]);
    return askJson({ cleared, left: leftOf(counters) } satisfies AskClearOk);
  } catch (error) {
    console.error(`[ask] clear error class=${errorClass(error)}`);
    return askFail("error", days);
  }
}

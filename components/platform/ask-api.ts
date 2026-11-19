// Ask's calls to the server, over HTTP only, through send() (contract §16.2). Everything
// that comes back is checked before the sheet shows it: unknown kinds are dropped, links
// keep only the fixed ones (askLinkOk), and urgent and crisis turns never carry AI text.
// The browser keys on `error`, never on the status.
import {
  ASK_ERROR_STATUS,
  ASK_KINDS,
  ASK_LIMITS,
  ASK_NOTICE_PARTS,
  ASK_TURN_KINDS,
  askLinkOk,
  type AskCall,
  type AskClearOk,
  type AskConsentOk,
  type AskError,
  type AskErrorCode,
  type AskLink,
  type AskNotice,
  type AskNoticeMarker,
  type AskPostOk,
  type AskRequest,
  type AskThread,
  type AskTurn,
  type AskTurnKind,
} from "@/lib/ask/types";
import { send as realSend } from "./net";

export type Send = typeof realSend;
export type ApiDeps = { send: Send; now: () => number; sleep: (ms: number) => Promise<void> };
const realDeps: ApiDeps = { send: realSend, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** send() reports its own timeout as offline; one that took about this long was a timeout, not a dead line. */
export const TIMED_OUT_AFTER_MS = ASK_LIMITS.clientTimeoutMs - 1_000;
/** How long after sending the browser keeps asking GET whether the question landed. */
export const WAIT_FOR_LANDING_MS = ASK_LIMITS.pendingStaleSeconds * 1_000;

// ── Cleaning what the server sent ─────────────────────────────────────────

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
const LANG = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;
const CALLS: readonly AskCall[] = ["112", "14416"];
const STATUSES = ["low", "edge_low", "in_range", "edge_high", "high", "unknown"] as const;

export function isErrorCode(x: unknown): x is AskErrorCode {
  return typeof x === "string" && Object.hasOwn(ASK_ERROR_STATUS, x);
}

function cleanNotice(raw: unknown): AskNotice | null {
  const n = obj(raw);
  if (!n || (n.level !== "doctor" && n.level !== "urgent" && n.level !== "crisis")) return null;
  const markers: AskNoticeMarker[] = (Array.isArray(n.markers) ? n.markers : []).flatMap((m) => {
    const o = obj(m);
    const name = str(o?.name);
    if (!o || !name) return [];
    const status = STATUSES.find((s) => s === o.status) ?? "unknown";
    return [{ name, status, flag: o.flag === "urgent" ? "urgent" : "doctor" }];
  });
  return {
    level: n.level,
    // Crisis is calm on purpose: no label, whatever arrives.
    label: n.level === "crisis" ? null : str(n.label),
    parts: strs(n.parts).filter((p): p is AskNotice["parts"][number] => (ASK_NOTICE_PARTS as readonly string[]).includes(p)),
    lines: strs(n.lines),
    markers,
    calls: strs(n.calls).filter((c): c is AskCall => (CALLS as readonly string[]).includes(c)),
  };
}

function cleanLinks(raw: unknown, kind: AskTurnKind): AskLink[] {
  if (kind === "off_topic" || kind === "crisis") return [];
  const links = (Array.isArray(raw) ? raw : []).filter((l): l is AskLink => !!obj(l) && askLinkOk(l as { id: unknown; href: unknown }));
  const kept = kind === "urgent" ? links.filter((l) => l.id === "report") : links;
  return kept.filter((l, i) => kept.findIndex((m) => m.id === l.id) === i).slice(0, ASK_LIMITS.linksMax);
}

/** A turn as the sheet may show it, or null when it isn't one. */
export function cleanTurn(raw: unknown): AskTurn | null {
  const t = obj(raw);
  const kind = ASK_TURN_KINDS.find((k) => k === t?.kind);
  const id = str(t?.id);
  const clientKey = str(t?.clientKey);
  const question = str(t?.question);
  if (!t || !kind || !id || !clientKey || question == null) return null;
  const removed = t.removed === "report_deleted" ? "report_deleted" : null;
  // Urgent and crisis replies are code's words only: any AI text that slipped through is dropped.
  const answer = removed || kind === "urgent" || kind === "crisis" ? null : str(t.answer);
  const lang = str(t.lang);
  return {
    id,
    clientKey,
    question,
    at: str(t.at) ?? new Date(0).toISOString(),
    kind,
    answer,
    notice: removed ? null : cleanNotice(t.notice),
    links: removed ? [] : cleanLinks(t.links, kind),
    lang: lang && LANG.test(lang) ? lang : "en",
    removed,
    stale: t.stale === true,
    demo: t.demo === true,
  };
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const left = (x: unknown) => {
  const n = num(x);
  return n == null ? null : Math.max(0, Math.min(ASK_LIMITS.perDay, Math.round(n)));
};

/** The day fields any reply may carry; missing ones stay missing. */
export function dayFields(raw: unknown): { left?: number; day?: string; resetsAt?: string } {
  const o = obj(raw);
  const out: { left?: number; day?: string; resetsAt?: string } = {};
  const l = left(o?.left);
  if (l != null) out.left = l;
  const day = str(o?.day);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) out.day = day;
  const resetsAt = str(o?.resetsAt);
  if (resetsAt) out.resetsAt = resetsAt;
  return out;
}

export function cleanThread(raw: unknown): AskThread | null {
  const o = obj(raw);
  const d = dayFields(raw);
  if (!o || d.left == null || !d.day || !d.resetsAt) return null;
  const pending = obj(o.pending);
  const pinned = obj(o.pinned);
  const s = obj(o.starters);
  const named = (x: unknown) => {
    const name = str(obj(x)?.name);
    return name ? { name } : null;
  };
  const protein = num(s?.proteinLeftG);
  return {
    left: d.left,
    day: d.day,
    resetsAt: d.resetsAt,
    turns: (Array.isArray(o.turns) ? o.turns : []).map(cleanTurn).filter((t): t is AskTurn => !!t),
    pending:
      pending && str(pending.clientKey) && str(pending.question) != null
        ? { clientKey: pending.clientKey as string, question: pending.question as string, at: str(pending.at) ?? new Date().toISOString() }
        : null,
    state: o.state === "paused" || o.state === "off" ? o.state : "ready",
    consentNeeded: o.consentNeeded === true,
    pinned: { urgent: strs(pinned?.urgent), printedFor: str(pinned?.printedFor) },
    report: o.report === "ready" || o.report === "reading" ? o.report : "none",
    region: o.region === "other" ? "other" : "in",
    readLanguage: o.readLanguage === "hi" || o.readLanguage === "hinglish" ? o.readLanguage : "en",
    starters: {
      archetype: str(s?.archetype) ?? "starting",
      flagged: named(s?.flagged),
      foodMarker: named(s?.foodMarker),
      proteinLeftG: protein != null && protein >= 10 ? Math.round(protein) : null,
      mealsToday: Math.max(0, num(s?.mealsToday) ?? 0),
      mealsEver: s?.mealsEver === true,
      hasGaps: s?.hasGaps === true,
      stackItem: str(s?.stackItem),
    },
  };
}

export function cleanPost(raw: unknown): AskPostOk | null {
  const o = obj(raw);
  const d = dayFields(raw);
  const kind = ASK_KINDS.find((k) => k === o?.kind);
  if (!o || !kind || d.left == null || !d.day || !d.resetsAt) return null;
  const day = { left: d.left, day: d.day, resetsAt: d.resetsAt };
  if (kind === "limit") return { ...day, kind, turn: null };
  const turn = cleanTurn(o.turn);
  return turn ? { ...day, kind: turn.kind, turn } : null;
}

const errorOf = (data: unknown): AskErrorCode => {
  const e = obj(data)?.error;
  return isErrorCode(e) ? e : "error";
};
const errorBody = (data: unknown): AskError => ({ error: errorOf(data), ...dayFields(data) });

// ── The calls ─────────────────────────────────────────────────────────────

export type ThreadResult = { ok: true; thread: AskThread } | { ok: false; error: AskErrorCode | "offline" };

/** GET today's thread. */
export async function getThread(send: Send = realSend): Promise<ThreadResult> {
  const r = await send("/api/ask", { method: "GET", timeoutMs: 15_000 });
  if (r.offline) return { ok: false, error: "offline" };
  if (!r.ok) return { ok: false, error: errorOf(r.data) };
  const thread = cleanThread(r.data);
  return thread ? { ok: true, thread } : { ok: false, error: "error" };
}

/** How a question ended, from the browser's side. */
export type AskOutcome =
  | { type: "ok"; reply: AskPostOk }
  /** POST timed out, but GET found the answer. */
  | { type: "landed"; turn: AskTurn; thread: AskThread }
  | { type: "error"; error: AskErrorCode; body: AskError }
  /** The connection dropped quickly: nothing reached the server, or nothing came back. */
  | { type: "offline" }
  /** No answer within the wait; `thread` is the last GET, if any came back. */
  | { type: "timeout"; thread: AskThread | null };

/**
 * POST a question. If the reply doesn't come within the browser's wait, GET looks for it
 * by its key and, while it's still being answered, asks again every 2 s, up to 45 s after
 * sending. Nothing here resends the question: only the person's "Try again" does, with
 * the same key, so it's counted once.
 */
export async function askQuestion(req: AskRequest, deps: ApiDeps = realDeps): Promise<AskOutcome> {
  const started = deps.now();
  const r = await deps.send("/api/ask", { body: req, timeoutMs: ASK_LIMITS.clientTimeoutMs });
  if (r.ok) {
    const reply = cleanPost(r.data);
    return reply ? { type: "ok", reply } : { type: "error", error: "error", body: { error: "error" } };
  }
  if (!r.offline) return { type: "error", error: errorOf(r.data), body: errorBody(r.data) };
  if (deps.now() - started < TIMED_OUT_AFTER_MS) return { type: "offline" };

  let last: AskThread | null = null;
  for (;;) {
    const t = await getThread(deps.send);
    if (t.ok) {
      last = t.thread;
      const turn = t.thread.turns.find((x) => x.clientKey === req.clientKey);
      if (turn) return { type: "landed", turn, thread: t.thread };
      // Not answered and not in flight: it never landed, or the server handed it back.
      if (t.thread.pending?.clientKey !== req.clientKey) return { type: "timeout", thread: last };
    }
    if (deps.now() - started + ASK_LIMITS.pollEveryMs > WAIT_FOR_LANDING_MS) return { type: "timeout", thread: last };
    await deps.sleep(ASK_LIMITS.pollEveryMs);
  }
}

export type SimpleResult<T> = { ok: true; data: T } | { ok: false; error: AskErrorCode | "offline" };

/** "Clear now": deletes today's answered turns; questions used still count. */
export async function clearThread(send: Send = realSend): Promise<SimpleResult<Omit<AskClearOk, "left"> & { left: number | null }>> {
  const r = await send("/api/ask", { method: "DELETE" });
  if (r.offline) return { ok: false, error: "offline" };
  if (!r.ok) return { ok: false, error: errorOf(r.data) };
  return { ok: true, data: { cleared: num(obj(r.data)?.cleared) ?? 0, left: left(obj(r.data)?.left) } };
}

/** "Got it" on the one-time notice. */
export async function acceptConsent(send: Send = realSend): Promise<SimpleResult<AskConsentOk>> {
  const r = await send("/api/ask/consent", { body: {} });
  if (r.offline) return { ok: false, error: "offline" };
  if (!r.ok) return { ok: false, error: errorOf(r.data) };
  return { ok: true, data: { consentAt: str(obj(r.data)?.consentAt) ?? new Date().toISOString() } };
}

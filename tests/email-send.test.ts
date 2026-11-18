// Sending lifecycle email (lib/email/send.ts) against a real embedded database, with the
// Resend SDK replaced by a fake: one send per (person, kind, key) however many calls race;
// the day's budget holds and leaves codes their share; stopped, paused and bounced people
// get nothing; Resend's answers are recorded so a retry can never send twice; nothing
// goes from anywhere but production.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Payload = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
};
type Reply = { data: unknown; error: { statusCode: number | null; name: string; message: string } | null; headers: Record<string, string> | null };
type Fake = { calls: { kind: "send" | "batch"; payloads: Payload[]; key: string }[]; replies: Reply[]; onSend?: (sendId: string) => Promise<void> };
const g = globalThis as unknown as { __fake: Fake };
g.__fake = { calls: [], replies: [] };

allowAppImports({
  resend: `
    const sendId = (p) => p.tags?.find((t) => t.name === "send_id")?.value ?? "other";
    export class Resend {
      constructor(key) {
        this.emails = { send: async (p, o) => {
          globalThis.__fake.calls.push({ kind: "send", payloads: [p], key: o.idempotencyKey });
          if (globalThis.__fake.onSend) await globalThis.__fake.onSend(sendId(p));
          return globalThis.__fake.replies.shift() ?? { data: { id: "re_" + sendId(p) }, error: null, headers: {} };
        } };
        this.batch = { send: async (ps, o) => {
          globalThis.__fake.calls.push({ kind: "batch", payloads: ps, key: o.idempotencyKey });
          return globalThis.__fake.replies.shift() ?? { data: { data: ps.map((p) => ({ id: "re_" + sendId(p) })) }, error: null, headers: {} };
        } };
      }
    }
  `,
});
const removeDatabase = tempDatabase();
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_LINK_SECRET = "test-email-link-secret";
process.env.RESEND_REPLY_TO = "team@example.com";
process.env.FEEDBACK_REPLY_TO = "feedback@example.com";
// A local run that opts in; the "only from production" tests below change it.
process.env.EMAIL_SEND_LOCAL = "1";
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.EMAIL_BATCH;

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const send = await import("../lib/email/send.ts");
const { setPrefs, pauseWeekly } = await import("../lib/email/prefs.ts");
const { suppress } = await import("../lib/email/suppress.ts");
const { readStopToken } = await import("../lib/email/tokens.ts");
const { sendWelcomeEmail } = await import("../lib/waitlist/email.ts");
type Frame = import("../lib/email/types.ts").EmailFrame;

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});
beforeEach(() => {
  g.__fake.calls = [];
  g.__fake.replies = [];
  g.__fake.onSend = undefined;
});

let n = 0;
async function person(name: string | null = "Asha Rao") {
  const d = await db();
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const email = `person${n}@example.com`;
  await d.insert(schema.users).values({ id, email });
  await d.insert(schema.profiles).values({ userId: id, name });
  return { id, email };
}

const frames: Frame[] = [];
const render = (frame: Frame) => {
  frames.push(frame);
  return { subject: "Your week", preheader: "", html: `<a href="${frame.siteUrl}/wraps?e=${frame.sendId}">Open</a> ${frame.stopUrl ?? ""}`, text: "Open your wrap" };
};
const ORIGIN = "https://www.d-human.fit";
const email = (userId: string, kind: "welcome" | "weekly" | "feedback" | "welcome_unfinished" = "weekly", dedupeKey = "2026-11-16") => ({
  userId,
  kind,
  dedupeKey: kind.startsWith("welcome") ? "once" : dedupeKey,
  localDate: "2026-11-22",
  render,
});
const row = async (id: string) => {
  const d = await db();
  const [r] = await d.select().from(schema.emailSends).where(eq(schema.emailSends.id, id));
  return r;
};
const rowsFor = async (userId: string) => {
  const d = await db();
  return d.select().from(schema.emailSends).where(eq(schema.emailSends.userId, userId));
};
async function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const put = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  put(env);
  try {
    await run();
  } finally {
    put(saved);
  }
}
const fail = (statusCode: number | null, name: string, headers: Record<string, string> = {}): Reply => ({ data: null, error: { statusCode, name, message: name }, headers });

describe("one send per person, kind and key", () => {
  it("sends a welcome once, with the send id in its links and no stop link", async () => {
    const p = await person();
    const first = await send.sendLifecycle(email(p.id, "welcome"), { origin: ORIGIN });
    assert.equal(first.status, "sent");
    assert.equal((await send.sendLifecycle(email(p.id, "welcome"), { origin: ORIGIN })).status, "duplicate");
    assert.equal(g.__fake.calls.length, 1);

    const call = g.__fake.calls[0];
    assert.equal(call.key, `welcome:${p.id}:once`);
    const payload = call.payloads[0];
    assert.equal(payload.to, p.email);
    assert.equal(payload.headers, undefined, "welcomes carry no List-Unsubscribe");
    assert.match(payload.from, /dhuman\.fit/);
    // Tags carry ids only: never an address, a name or anything about health.
    assert.deepEqual(payload.tags!.map((t) => t.name), ["kind", "send_id"]);
    assert.deepEqual(payload.tags!.map((t) => t.value), ["welcome", (first as { sendId: string }).sendId]);

    const frame = frames.at(-1)!;
    assert.equal(frame.sendId, (first as { sendId: string }).sendId);
    assert.equal(frame.stopUrl, null);
    assert.equal(frame.firstName, "Asha");
    assert.equal(frame.settingsUrl, `${ORIGIN}/settings#emails`);

    const r = await row(frame.sendId);
    assert.equal(r.status, "sent");
    assert.equal(r.providerId, `re_${frame.sendId}`);
    assert.ok(r.sentAt);
  });

  it("gives weekly and feedback email RFC 8058 headers that stop only that kind", async () => {
    const p = await person(null);
    assert.equal((await send.sendLifecycle(email(p.id, "weekly"), { origin: ORIGIN })).status, "sent");
    assert.equal((await send.sendLifecycle(email(p.id, "feedback", "fb-1"), { origin: ORIGIN, now: new Date(Date.now() + 1) })).status, "sent");
    const [weekly, feedback] = g.__fake.calls.map((c) => c.payloads[0]);

    for (const [payload, category] of [[weekly, "weekly"], [feedback, "questions"]] as const) {
      const header = payload.headers!["List-Unsubscribe"];
      assert.match(header, /^<https:\/\/www\.d-human\.fit\/api\/email\/unsubscribe\?t=v1\.[^>]+>$/);
      assert.equal(payload.headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
      const t = new URL(header.slice(1, -1)).searchParams.get("t");
      assert.deepEqual(readStopToken(t), { p: "stop", u: p.id, k: category });
      assert.doesNotMatch(header, /@/, "no address in the link");
    }
    assert.equal(weekly.replyTo, "team@example.com");
    assert.equal(feedback.replyTo, "feedback@example.com");
    const weeklyFrame = frames.find((f) => f.sendId === weekly.tags![1].value)!;
    assert.equal(new URL(weeklyFrame.stopUrl!).pathname, "/email/stop");
    assert.equal(weeklyFrame.firstName, null);
  });

  it("sends once when six calls race for the same email", async () => {
    const p = await person();
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => send.sendLifecycle(email(p.id, "weekly", "2026-11-09"), { origin: ORIGIN })));
    assert.equal(outcomes.filter((o) => o.status === "sent").length, 1);
    assert.equal(outcomes.filter((o) => o.status === "duplicate").length, 5);
    assert.equal(g.__fake.calls.length, 1);
    assert.equal((await rowsFor(p.id)).length, 1);
  });

  it("builds the same payload every time, so Resend accepts a retry under the same key", () => {
    const c = { sendId: "s-1", email: email("u-1", "weekly"), recipient: { userId: "u-1", email: "a@example.com", firstName: null, prefs: { weekly: true, questions: true, weeklyPausedAt: null }, suppressed: false } };
    const rendered = render({ sendId: "s-1", siteUrl: ORIGIN } as Frame);
    assert.deepEqual(send.resendPayload(c, rendered, ORIGIN), send.resendPayload(c, rendered, ORIGIN));
  });
});

describe("who gets nothing", () => {
  it("skips people who stopped the kind, whose weekly email is paused, or whose address bounced", async () => {
    const off = await person();
    await setPrefs(off.id, { weekly: false }, "settings");
    assert.deepEqual(await send.sendLifecycle(email(off.id, "weekly")), { status: "skipped", reason: "turned_off" });
    assert.equal((await send.sendLifecycle(email(off.id, "feedback", "fb-1"))).status, "sent", "questions are still on");

    const paused = await person();
    await pauseWeekly(paused.id);
    assert.deepEqual(await send.sendLifecycle(email(paused.id, "weekly")), { status: "skipped", reason: "turned_off" });

    const bounced = await person();
    await suppress(bounced.email.toUpperCase(), "bounce"); // matched whatever the case
    assert.deepEqual(await send.sendLifecycle(email(bounced.id, "welcome")), { status: "skipped", reason: "suppressed" });

    assert.deepEqual(await send.sendLifecycle(email("no-such-person", "welcome")), { status: "skipped", reason: "no_person" });
    // Nothing skipped leaves a ledger row behind.
    for (const p of [paused, bounced]) assert.equal((await rowsFor(p.id)).length, 0);
    assert.equal(g.__fake.calls.length, 1);
  });
});

describe("the day's budget", () => {
  // Days of their own, far from the other tests' sends.
  const day = new Date("2030-01-10T09:00:00Z");
  const at = (minutes: number) => new Date(day.getTime() + minutes * 60_000);
  let codeN = 0;
  const code = async (createdAt: Date) => {
    const d = await db();
    await d.insert(schema.loginCodes).values({ id: `code-${++codeN}`, email: "busy@example.com", codeHash: "x", expiresAt: createdAt, createdAt });
  };

  it("keeps 30 free for codes, counting codes, lifecycle and other email, and re-reads before every send", async () => {
    const d = await db();
    const filler = await person();
    // 45 codes today (and 2 yesterday, which don't count), 3 waitlist welcomes, 19 lifecycle
    // sends: 45 + 3 + 19 = 67 of the 70 that may go before codes' last 30. 3 places left.
    for (let i = 0; i < 45; i++) await code(at(-60 + i));
    for (let i = 0; i < 2; i++) await code(new Date("2030-01-09T23:00:00Z"));
    await d.insert(schema.emailDailyCounts).values({ day: "2030-01-10", stream: "waitlist_welcome", sent: 3 });
    await d.insert(schema.emailSends).values(
      Array.from({ length: 19 }, (_, i) => ({ id: `old-${i}`, userId: filler.id, kind: "weekly", dedupeKey: `k-${i}`, localDate: "2030-01-10", status: "sent", sentAt: at(-30) })),
    );
    assert.deepEqual(await send.budgetToday(at(0)), { left: 3, codesToday: 45, lifecycleToday: 19, otherToday: 3 });

    // A sign-in code is asked for while the first email is going out: it takes a place.
    let first = true;
    g.__fake.onSend = async () => {
      if (first) await code(at(1));
      first = false;
    };
    const people = [await person(), await person(), await person(), await person()];
    const outcomes = await send.sendLifecycleBatch(
      people.map((p) => email(p.id, "weekly", "2030-01-06")),
      { now: at(1), origin: ORIGIN, paceMs: 0 },
    );
    assert.deepEqual(outcomes.map((o) => o.status), ["sent", "sent", "budget", "budget"], "the first in priority order go");
    // One by one by default: each with its own key.
    assert.deepEqual(
      g.__fake.calls.map((c) => [c.kind, c.key]),
      people.slice(0, 2).map((p) => ["send", `weekly:${p.id}:2030-01-06`]),
    );
    for (const p of people.slice(2)) assert.equal((await rowsFor(p.id)).length, 0, "over budget: no row, so the next run picks them up");
    assert.deepEqual(await send.budgetToday(at(2)), { left: 0, codesToday: 46, lifecycleToday: 21, otherToday: 3 });
    assert.equal((await send.sendLifecycle(email(people[2].id, "weekly", "2030-01-06"), { now: at(3) })).status, "budget");
  });

  it("with EMAIL_BATCH=1, one Resend batch call, ids mapped back by position", async () => {
    const people = [await person(), await person(), await person()];
    await withEnv({ EMAIL_BATCH: "1" }, async () => {
      const outcomes = await send.sendLifecycleBatch(people.map((p) => email(p.id, "weekly", "2030-02-04")), { now: new Date("2030-02-05T09:00:00Z"), origin: ORIGIN });
      assert.deepEqual(outcomes.map((o) => o.status), ["sent", "sent", "sent"]);
      assert.equal(g.__fake.calls.length, 1);
      assert.equal(g.__fake.calls[0].kind, "batch");
      assert.match(g.__fake.calls[0].key, /^batch:[0-9a-f-]{36}$/);
      for (const o of outcomes) {
        const sent = o as { sendId: string; providerId: string };
        assert.equal((await row(sent.sendId)).providerId, `re_${sent.sendId}`);
      }
    });
  });
});

describe("Resend's answers", () => {
  it("a clear refusal gives the day's place back; the retry goes under a new key", async () => {
    const p = await person();
    g.__fake.replies.push(fail(422, "validation_error"));
    const first = await send.sendLifecycle(email(p.id, "weekly", "2026-10-05"), { origin: ORIGIN });
    assert.equal(first.status, "failed");
    const id = (first as { sendId: string }).sendId;
    let r = await row(id);
    assert.equal(r.status, "failed");
    assert.equal(r.attempts, 1);
    assert.equal(r.sentAt, null, "not counted against today's budget");

    assert.ok((await send.sendsToRetry()).includes(id));
    const retried = await send.retrySend(id, render, { origin: ORIGIN });
    assert.equal(retried.status, "sent");
    assert.equal(g.__fake.calls.at(-1)!.key, `weekly:${p.id}:2026-10-05:r1`);
    r = await row(id);
    assert.equal(r.status, "sent");
    assert.equal((await send.retrySend(id, render)).status, "duplicate", "never twice");
  });

  it("no clear answer keeps the row and its key: retried once it settles, unknown after 23 hours", async () => {
    const p = await person();
    g.__fake.replies.push(fail(null, "application_error"));
    const first = await send.sendLifecycle(email(p.id, "weekly", "2026-10-12"), { origin: ORIGIN });
    assert.equal(first.status, "pending");
    const id = (first as { sendId: string }).sendId;
    const r = await row(id);
    assert.equal(r.status, "sending");
    assert.ok(r.sentAt, "still counted: it may have gone");

    assert.equal((await send.retrySend(id, render)).status, "pending", "too soon: it may still be in flight");
    assert.ok(!(await send.sendsToRetry()).includes(id));
    const later = new Date(r.sentAt!.getTime() + 11 * 60_000);
    assert.ok((await send.sendsToRetry(later)).includes(id));
    assert.equal((await send.retrySend(id, render, { now: later, origin: ORIGIN })).status, "sent");
    assert.equal(g.__fake.calls.at(-1)!.key, `weekly:${p.id}:2026-10-12`, "same key, so Resend sends it at most once");

    const q = await person();
    g.__fake.replies.push(fail(503, "internal_server_error"));
    const second = (await send.sendLifecycle(email(q.id, "weekly", "2026-10-12"), { origin: ORIGIN })) as { sendId: string };
    const dayLater = new Date(Date.now() + 24 * 60 * 60_000);
    assert.equal((await send.retrySend(second.sendId, render, { now: dayLater })).status, "unknown");
    assert.equal((await row(second.sendId)).status, "unknown");
    const calls = g.__fake.calls.length;
    assert.equal((await send.retrySend(second.sendId, render, { now: dayLater })).status, "duplicate");
    assert.equal(g.__fake.calls.length, calls, "an unknown send is never resent");
  });

  it("a 409 (key reused for other content, or in flight) is unknown, never resent", async () => {
    const p = await person();
    g.__fake.replies.push(fail(409, "invalid_idempotent_request"));
    const o = (await send.sendLifecycle(email(p.id, "weekly", "2026-10-19"))) as { status: string; sendId: string };
    assert.equal(o.status, "unknown");
    assert.equal((await row(o.sendId)).status, "unknown");
  });

  it("a rate limit says when to come back", async () => {
    const p = await person();
    g.__fake.replies.push(fail(429, "rate_limit_exceeded", { "retry-after": "2" }));
    const o = await send.sendLifecycle(email(p.id, "weekly", "2026-10-26"));
    assert.equal(o.status, "failed");
    assert.equal((o as { retryAfterSeconds?: number }).retryAfterSeconds, 2);
  });

  it("with EMAIL_BATCH=1, an unclear batch answer is never retried email by email", async () => {
    const [a, b] = [await person(), await person()];
    g.__fake.replies.push(fail(null, "application_error"));
    await withEnv({ EMAIL_BATCH: "1" }, async () => {
      const outcomes = await send.sendLifecycleBatch([email(a.id, "weekly", "2026-11-02"), email(b.id, "weekly", "2026-11-02")]);
      assert.deepEqual(outcomes.map((o) => o.status), ["pending", "pending"]);
      const id = (outcomes[0] as { sendId: string }).sendId;
      const later = new Date(Date.now() + 11 * 60_000);
      assert.equal((await send.retrySend(id, render, { now: later })).status, "unknown");
    });
  });

  it("one by one (the default), an unclear answer strands only that email", async () => {
    const [a, b] = [await person(), await person()];
    g.__fake.replies.push(fail(null, "application_error"));
    const outcomes = await send.sendLifecycleBatch([email(a.id, "weekly", "2026-11-02"), email(b.id, "weekly", "2026-11-02")], { paceMs: 0 });
    assert.deepEqual(outcomes.map((o) => o.status), ["pending", "sent"]);
    const id = (outcomes[0] as { sendId: string }).sendId;
    const later = new Date(Date.now() + 11 * 60_000);
    assert.equal((await send.retrySend(id, render, { now: later })).status, "sent", "retried under its own key");
  });

  it("keeps a bounce that Resend's webhook recorded before its own answer came back", async () => {
    const p = await person();
    g.__fake.onSend = async (sendId) => {
      const d = await db();
      await d.update(schema.emailSends).set({ status: "bounced" }).where(eq(schema.emailSends.id, sendId));
    };
    const o = (await send.sendLifecycle(email(p.id, "weekly", "2026-09-14"))) as { sendId: string; providerId: string };
    const r = await row(o.sendId);
    assert.equal(r.status, "bounced");
    assert.equal(r.providerId, o.providerId, "Resend's id is still recorded");
  });

  it("a template that throws fails that send only, and nothing reaches Resend", async () => {
    const p = await person();
    const o = await send.sendLifecycle({ ...email(p.id, "weekly", "2026-09-28"), render: () => { throw new Error("boom"); } });
    assert.equal(o.status, "failed");
    assert.equal((o as { error: string }).error, "render");
    assert.equal(g.__fake.calls.length, 0);
  });

  it("someone who stops the email before a retry isn't sent it", async () => {
    const p = await person();
    g.__fake.replies.push(fail(422, "validation_error"));
    const o = (await send.sendLifecycle(email(p.id, "weekly", "2026-09-21"))) as { sendId: string };
    await setPrefs(p.id, { weekly: false }, "stop_link");
    assert.deepEqual(await send.retrySend(o.sendId, render), { status: "skipped", reason: "turned_off" });
    assert.ok(!(await send.sendsToRetry()).includes(o.sendId), "and the sweep lets it go");
  });
});

describe("configuration", () => {
  it("production without RESEND_API_KEY claims nothing", async () => {
    const p = await person();
    const saved = { key: process.env.RESEND_API_KEY, env: process.env.NODE_ENV };
    delete process.env.RESEND_API_KEY;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      assert.deepEqual(await send.sendLifecycle(email(p.id, "welcome")), { status: "not_configured", reason: "no_api_key" });
    } finally {
      process.env.RESEND_API_KEY = saved.key;
      if (saved.env === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string>).NODE_ENV = saved.env;
    }
    assert.equal((await rowsFor(p.id)).length, 0);
  });

  it("local dev without a key logs the send instead and records it", async () => {
    const p = await person();
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const o = (await send.sendLifecycle(email(p.id, "welcome"))) as { status: string; sendId: string; providerId: string };
      assert.equal(o.status, "sent");
      assert.equal(o.providerId, `log:${o.sendId}`);
    } finally {
      process.env.RESEND_API_KEY = saved;
    }
    assert.equal(g.__fake.calls.length, 0);
  });

  it("refuses a local date that isn't YYYY-MM-DD", async () => {
    await assert.rejects(send.sendLifecycle({ ...email("u", "welcome"), localDate: "22/11/2026" }), /localDate/);
  });
});

describe("taps", () => {
  it("count once, and only for the email's own person", async () => {
    const [p, other] = [await person(), await person()];
    const o = (await send.sendLifecycle(email(p.id, "weekly", "2026-08-03"))) as { sendId: string };
    assert.equal(await send.recordTap(other.id, o.sendId), false);
    assert.equal((await row(o.sendId)).firstTapAt, null);
    assert.equal(await send.recordTap(p.id, o.sendId), true);
    const first = (await row(o.sendId)).firstTapAt;
    assert.ok(first);
    assert.equal(await send.recordTap(p.id, o.sendId, new Date(Date.now() + 60_000)), false);
    assert.deepEqual((await row(o.sendId)).firstTapAt, first);
  });
});

describe("only from production", () => {
  const logs: string[] = [];
  const quiet = async (run: () => Promise<void>) => {
    const info = console.info;
    console.info = (...args: unknown[]) => void logs.push(args.join(" "));
    try {
      await run();
    } finally {
      console.info = info;
    }
  };

  it("a local run without EMAIL_SEND_LOCAL=1 claims and sends nothing, and says why", async () => {
    const p = await person();
    await quiet(() =>
      withEnv({ EMAIL_SEND_LOCAL: undefined }, async () => {
        assert.deepEqual(await send.sendLifecycle(email(p.id, "welcome")), { status: "not_configured", reason: "not_production" });
        const list = await send.sendLifecycleBatch([email(p.id, "weekly"), email(p.id, "feedback", "fb-1")], { paceMs: 0 });
        assert.deepEqual(list.map((o) => o.status), ["not_configured", "not_configured"]);
      }),
    );
    assert.equal((await rowsFor(p.id)).length, 0);
    assert.equal(g.__fake.calls.length, 0);
    assert.ok(logs.some((l) => /goes only from production/.test(l) && !l.includes("@")), "a log line, with no address in it");
  });

  it("a preview deployment sends nothing, even with a key, a real database and EMAIL_SEND_LOCAL=1", async () => {
    const p = await person();
    await quiet(() =>
      withEnv({ VERCEL: "1", VERCEL_ENV: "preview", EMAIL_SEND_LOCAL: "1" }, async () => {
        assert.deepEqual(await send.sendLifecycle(email(p.id, "welcome")), { status: "not_configured", reason: "not_production" });
      }),
    );
    assert.equal(g.__fake.calls.length, 0);
  });

  it("production sends", async () => {
    const p = await person();
    await withEnv({ VERCEL: "1", VERCEL_ENV: "production", EMAIL_SEND_LOCAL: undefined }, async () => {
      assert.equal((await send.sendLifecycle(email(p.id, "welcome"), { origin: ORIGIN })).status, "sent");
    });
    assert.equal(g.__fake.calls.length, 1);
  });

  it("retries are held back outside production too", async () => {
    const p = await person();
    g.__fake.replies.push(fail(422, "validation_error"));
    const o = (await send.sendLifecycle(email(p.id, "weekly", "2026-07-06"))) as { sendId: string };
    await quiet(() =>
      withEnv({ EMAIL_SEND_LOCAL: undefined }, async () => {
        assert.deepEqual(await send.retrySend(o.sendId, render), { status: "not_configured", reason: "not_production" });
      }),
    );
    assert.equal(g.__fake.calls.length, 1);
  });
});

describe("the founders' alert", () => {
  const alert = { key: "weekly-cap:2026-11-16", subject: "Weekly email: 60 due, 55 fit today", text: "60 people are due a weekly email; 55 fit in today's budget." };
  const countToday = async (stream: string) => {
    const d = await db();
    const rows = await d.select().from(schema.emailDailyCounts);
    return rows.filter((r) => r.stream === stream && r.day === new Date().toISOString().slice(0, 10)).reduce((n, r) => n + r.sent, 0);
  };

  it("goes from production to ALERT_EMAILS, once per key, and counts in today's budget", async () => {
    const before = (await send.budgetToday()).otherToday;
    await withEnv({ VERCEL: "1", VERCEL_ENV: "production", ALERT_EMAILS: " Founder@Example.com, cofounder@example.com,, not-an-address ", BLOG_OWNER_EMAILS: "owner@example.com" }, async () => {
      assert.deepEqual(await send.sendFounderAlert(alert), { status: "sent" });
    });
    const call = g.__fake.calls[0];
    assert.equal(call.key, "alert:weekly-cap:2026-11-16");
    assert.deepEqual(call.payloads[0].to, ["founder@example.com", "cofounder@example.com"]);
    assert.equal(await countToday("founder_alert"), 2);
    assert.equal((await send.budgetToday()).otherToday, before + 2);
  });

  it("falls back to BLOG_OWNER_EMAILS, and does nothing without anyone to tell", async () => {
    await withEnv({ VERCEL: "1", VERCEL_ENV: "production", ALERT_EMAILS: undefined, BLOG_OWNER_EMAILS: "owner@example.com" }, async () => {
      assert.deepEqual(await send.sendFounderAlert(alert), { status: "sent" });
      assert.deepEqual(g.__fake.calls[0].payloads[0].to, ["owner@example.com"]);
    });
    await withEnv({ VERCEL: "1", VERCEL_ENV: "production", ALERT_EMAILS: undefined, BLOG_OWNER_EMAILS: undefined }, async () => {
      assert.deepEqual(await send.sendFounderAlert(alert), { status: "not_configured", reason: "no_recipients" });
    });
    assert.equal(g.__fake.calls.length, 1);
  });

  it("goes only from production", async () => {
    const info = console.info;
    console.info = () => {};
    try {
      await withEnv({ VERCEL: "1", VERCEL_ENV: "preview", ALERT_EMAILS: "founder@example.com" }, async () => {
        assert.deepEqual(await send.sendFounderAlert(alert), { status: "not_configured", reason: "not_production" });
      });
      await withEnv({ EMAIL_SEND_LOCAL: undefined, ALERT_EMAILS: "founder@example.com" }, async () => {
        assert.deepEqual(await send.sendFounderAlert(alert), { status: "not_configured", reason: "not_production" });
      });
    } finally {
      console.info = info;
    }
    assert.equal(g.__fake.calls.length, 0);
  });
});

describe("the waitlist welcome", () => {
  it("counts in today's budget, alongside the send", async () => {
    const before = (await send.budgetToday()).otherToday;
    await sendWelcomeEmail("waitlist@example.com");
    assert.equal(g.__fake.calls.length, 1);
    assert.equal(g.__fake.calls[0].payloads[0].to, "waitlist@example.com");
    assert.equal((await send.budgetToday()).otherToday, before + 1);
  });
});

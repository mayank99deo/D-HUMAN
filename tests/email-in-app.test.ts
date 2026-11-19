// The app's side of lifecycle email: Settings → Emails saving its switches, and taps on
// email links (?e=) recorded once and dropped from the address. Against a real embedded
// database, through the same routes the screens call.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

const g = globalThis as unknown as { __testUser?: { id: string; email: string } | null };
allowAppImports({
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
});
const removeDatabase = tempDatabase();
process.env.EMAIL_LINK_SECRET = "test-email-link-secret";

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { getPrefs, pauseWeekly } = await import("../lib/email/prefs.ts");
const prefsRoute = await import("../app/api/email/prefs/route.ts");
const tapRoute = await import("../app/api/email/tap/route.ts");
const { saveSwitch, switchOn } = await import("../components/platform/email-prefs.ts");
const { emailTapFrom, firstTap } = await import("../components/platform/email-tap.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

const SITE = "https://www.d-human.fit";
let n = 0;
async function person() {
  const d = await db();
  const id = `30000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  await d.insert(schema.users).values({ id, email: `s${n}@example.com` });
  return { id, email: `s${n}@example.com` };
}

// What components/platform/net.ts's send() gives, but through the route itself.
async function postToRoute(url: string, init: { body: unknown }) {
  const route = url === "/api/email/prefs" ? prefsRoute : tapRoute;
  const res = await route.POST(new Request(`${SITE}${url}`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify(init.body) }));
  return { ok: res.ok, offline: false, data: (await res.json()) as Record<string, unknown> };
}

describe("Settings → Emails", () => {
  it("saves each switch for the signed-in person, and shows what the server saved", async () => {
    const p = await person();
    g.__testUser = p;
    const off = await saveSwitch(postToRoute, "weekly", false);
    assert.deepEqual(off, { ok: true, prefs: { weekly: false, questions: true, weeklyPaused: false } });
    assert.equal((await getPrefs(p.id)).weekly, false);
    const questions = await saveSwitch(postToRoute, "questions", false);
    assert.ok(questions.ok && !questions.prefs.questions && !questions.prefs.weekly);
    const d = await db();
    const [row] = await d.select().from(schema.emailPrefs).where(eq(schema.emailPrefs.userId, p.id));
    assert.equal(row.updatedVia, "settings");
  });

  it("shows a paused weekly email as off, and turning it on restarts it", async () => {
    const p = await person();
    g.__testUser = p;
    await pauseWeekly(p.id);
    const paused = { weekly: true, questions: true, weeklyPaused: true };
    assert.equal(switchOn(paused, "weekly"), false);
    assert.equal(switchOn(paused, "questions"), true);
    const on = await saveSwitch(postToRoute, "weekly", true);
    assert.deepEqual(on, { ok: true, prefs: { weekly: true, questions: true, weeklyPaused: false } });
    assert.equal((await getPrefs(p.id)).weeklyPausedAt, null);
  });

  it("says when nothing was saved, and never reports a guess", async () => {
    g.__testUser = null;
    const signedOut = await saveSwitch(postToRoute, "weekly", false);
    assert.equal(signedOut.ok, false);
    const offline = await saveSwitch(async () => ({ ok: false, offline: true, data: {} }), "weekly", false);
    assert.deepEqual(offline, { ok: false, message: "Not saved. No connection; check your signal and try again." });
    const odd = await saveSwitch(async () => ({ ok: true, offline: false, data: { weekly: "yes" as unknown as boolean } }), "weekly", true);
    assert.equal(odd.ok, false);
  });
});

describe("taps on email links", () => {
  it("finds e, keeps the rest of the address, and drops a malformed id without sending it", () => {
    assert.deepEqual(emailTapFrom(`${SITE}/wraps?week=2026-11-16&e=abc-123`), { sendId: "abc-123", cleanHref: "/wraps?week=2026-11-16" });
    assert.deepEqual(emailTapFrom(`${SITE}/settings?e=s9#emails`), { sendId: "s9", cleanHref: "/settings#emails" });
    assert.deepEqual(emailTapFrom(`${SITE}/fuel?e=%3Cscript%3E`), { sendId: null, cleanHref: "/fuel" });
    assert.deepEqual(emailTapFrom(`${SITE}/fuel?e=`), { sendId: null, cleanHref: "/fuel" });
    assert.equal(emailTapFrom(`${SITE}/fuel?usual=1`), null);
  });

  it("posts each tap once per page load", () => {
    assert.equal(firstTap("send-1"), true);
    assert.equal(firstTap("send-1"), false, "React's second effect run in development");
    assert.equal(firstTap("send-2"), true);
  });

  it("records the first tap on the person's own email only", async () => {
    const p = await person();
    const other = await person();
    const d = await db();
    const sendId = `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await d.insert(schema.emailSends).values({ id: sendId, userId: p.id, kind: "weekly", dedupeKey: "2026-11-16", localDate: "2026-11-22", status: "sent" });
    const firstTapAt = async () => (await d.select().from(schema.emailSends).where(eq(schema.emailSends.id, sendId)))[0].firstTapAt;

    g.__testUser = other;
    assert.equal((await postToRoute("/api/email/tap", { body: { e: sendId } })).ok, true, "same answer for someone else's id");
    assert.equal(await firstTapAt(), null);

    g.__testUser = p;
    await postToRoute("/api/email/tap", { body: { e: sendId } });
    const first = await firstTapAt();
    assert.ok(first instanceof Date);
    await new Promise((r) => setTimeout(r, 5));
    await postToRoute("/api/email/tap", { body: { e: sendId } });
    assert.equal((await firstTapAt())!.getTime(), first.getTime(), "a second tap keeps the first time");
  });
});

// Stopping lifecycle email: the RFC 8058 one-click endpoint, the settings API behind the
// stop page and Settings, and the tap recorder, against a real embedded database.
// The rule throughout: opening a link (what mail scanners do) never changes anything;
// only a POST does, and a stop link can only touch its own person's settings.
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
const { stopToken, feedbackToken } = await import("../lib/email/tokens.ts");
const { getPrefs, pauseWeekly, stopLinkState } = await import("../lib/email/prefs.ts");
const unsubscribe = await import("../app/api/email/unsubscribe/route.ts");
const prefsRoute = await import("../app/api/email/prefs/route.ts");
const tapRoute = await import("../app/api/email/tap/route.ts");

after(async () => {
  await removeDatabase();
});

const SITE = "https://www.d-human.fit";
let n = 0;
async function person() {
  const d = await db();
  const id = `10000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  await d.insert(schema.users).values({ id, email: `p${n}@example.com` });
  return { id, email: `p${n}@example.com` };
}
const prefsRow = async (userId: string) => {
  const d = await db();
  const [row] = await d.select().from(schema.emailPrefs).where(eq(schema.emailPrefs.userId, userId));
  return row ?? null;
};
const oneClick = (t: string | null, body: string | null = "List-Unsubscribe=One-Click") =>
  unsubscribe.POST(
    new Request(`${SITE}/api/email/unsubscribe${t === null ? "" : `?t=${encodeURIComponent(t)}`}`, {
      method: "POST",
      headers: body ? { "content-type": "application/x-www-form-urlencoded" } : {},
      body,
    }),
  );
// What Settings' fetch() sends: JSON from our own origin. `origin: null` leaves the header out.
const postJson = (body: unknown, origin: string | null = SITE) =>
  prefsRoute.POST(new Request(`${SITE}/api/email/prefs`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }));
const postForm = (fields: Record<string, string>) =>
  prefsRoute.POST(new Request(`${SITE}/api/email/prefs`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() }));

describe("one-click unsubscribe (RFC 8058)", () => {
  it("a POST without cookies turns off only that kind, with an empty 200", async () => {
    g.__testUser = null;
    const p = await person();
    const res = await oneClick(stopToken(p.id, "weekly"));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("location"), null);
    const prefs = await getPrefs(p.id);
    assert.equal(prefs.weekly, false);
    assert.equal(prefs.questions, true, "the other kind is untouched");
    assert.equal((await prefsRow(p.id))!.updatedVia, "one_click");
  });

  it("is harmless to repeat, and doesn't need the body", async () => {
    const p = await person();
    const t = stopToken(p.id, "questions");
    for (const body of ["List-Unsubscribe=One-Click", null, "anything"]) assert.equal((await oneClick(t, body)).status, 200);
    assert.equal((await getPrefs(p.id)).questions, false);
    assert.equal((await getPrefs(p.id)).weekly, true);
  });

  it("refuses a missing, forged or feedback link with 400", async () => {
    const p = await person();
    const good = stopToken(p.id, "weekly");
    for (const t of [null, "", "v1.abc.def", good.slice(0, -2), feedbackToken(p.id, "fb-1")]) assert.equal((await oneClick(t)).status, 400, String(t));
    assert.equal(await prefsRow(p.id), null);
  });

  it("answers 200 for a deleted account: nothing goes to it anyway", async () => {
    assert.equal((await oneClick(stopToken("20000000-0000-4000-8000-000000000000", "weekly"))).status, 200);
  });
});

describe("link scanners", () => {
  it("opening any link changes nothing: the GET goes to the stop page, which only reads", async () => {
    const p = await person();
    const t = stopToken(p.id, "weekly");

    const res = await unsubscribe.GET(new Request(`${SITE}/api/email/unsubscribe?t=${t}`));
    assert.equal(res.status, 303);
    const to = new URL(res.headers.get("location")!);
    assert.equal(to.pathname, "/email/stop");
    assert.equal(to.searchParams.get("t"), t);

    // What the stop page reads when it renders, and the settings API's GET.
    const state = await stopLinkState(t);
    assert.equal(state.status, "ok");
    assert.equal(state.status === "ok" && state.prefs.weekly, true);
    const view = await prefsRoute.GET(new Request(`${SITE}/api/email/prefs?t=${t}`));
    assert.deepEqual(await view.json(), { weekly: true, questions: true, weeklyPaused: false });

    assert.equal(await prefsRow(p.id), null, "no settings row was even created");
  });

  it("the stop page tells a broken link from a deleted account", async () => {
    assert.deepEqual(await stopLinkState("v1.nope.nope"), { status: "invalid" });
    assert.deepEqual(await stopLinkState(stopToken("30000000-0000-4000-8000-000000000000", "questions")), { status: "gone", category: "questions" });
  });
});

describe("the settings API", () => {
  it("a stop link reads and changes its own person's settings", async () => {
    g.__testUser = null;
    const p = await person();
    const t = stopToken(p.id, "weekly");
    const res = await postJson({ t, weekly: false });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { weekly: false, questions: true, weeklyPaused: false });
    assert.equal((await prefsRow(p.id))!.updatedVia, "stop_link");
    // The stop page's Undo and its other switch use the same link.
    assert.deepEqual(await (await postJson({ t, weekly: true, questions: false })).json(), { weekly: true, questions: false, weeklyPaused: false });
  });

  it("turning the weekly email back on clears a pause", async () => {
    const p = await person();
    await pauseWeekly(p.id);
    const t = stopToken(p.id, "weekly");
    assert.equal((await (await prefsRoute.GET(new Request(`${SITE}/api/email/prefs?t=${t}`))).json()).weeklyPaused, true);
    assert.deepEqual(await (await postJson({ t, weekly: true })).json(), { weekly: true, questions: true, weeklyPaused: false });
  });

  it("the no-JavaScript Confirm button posts a form and comes back to the page", async () => {
    const p = await person();
    const t = stopToken(p.id, "weekly");
    const res = await postForm({ t, weekly: "off" });
    assert.equal(res.status, 303);
    const to = new URL(res.headers.get("location")!);
    assert.equal(to.pathname, "/email/stop");
    assert.equal(to.searchParams.get("t"), t);
    assert.equal((await getPrefs(p.id)).weekly, false);
  });

  it("forms never act on the session alone, so another site can't post one", async () => {
    const p = await person();
    g.__testUser = { id: p.id, email: p.email };
    assert.equal((await postForm({ weekly: "off" })).status, 400);
    assert.equal((await postForm({ t: "", weekly: "off" })).status, 400);
    assert.equal((await getPrefs(p.id)).weekly, true);
    g.__testUser = null;
  });

  it("signed in, Settings changes the person's own settings; signed out, nothing", async () => {
    const p = await person();
    g.__testUser = { id: p.id, email: p.email };
    const res = await postJson({ questions: false });
    assert.equal(res.status, 200);
    assert.equal((await prefsRow(p.id))!.updatedVia, "settings");
    assert.deepEqual(await (await prefsRoute.GET(new Request(`${SITE}/api/email/prefs`))).json(), { weekly: true, questions: false, weeklyPaused: false });
    g.__testUser = null;
    assert.equal((await postJson({ questions: true })).status, 401);
    assert.equal((await prefsRoute.GET(new Request(`${SITE}/api/email/prefs`))).status, 401);
  });

  it("on the session, only our own pages can change settings; a stop link works from anywhere", async () => {
    const p = await person();
    g.__testUser = { id: p.id, email: p.email };
    assert.equal((await postJson({ weekly: false }, null)).status, 403, "no Origin");
    assert.equal((await postJson({ weekly: false }, "https://evil.example")).status, 403, "another site");
    assert.equal((await getPrefs(p.id)).weekly, true);
    g.__testUser = null;
    assert.equal((await postJson({ t: stopToken(p.id, "weekly"), weekly: false }, null)).status, 200);
    assert.equal((await getPrefs(p.id)).weekly, false);
  });

  it("a link wins over the session, and a bad link is refused rather than falling back to it", async () => {
    const [owner, other] = [await person(), await person()];
    g.__testUser = { id: other.id, email: other.email };
    await postJson({ t: stopToken(owner.id, "weekly"), weekly: false });
    assert.equal((await getPrefs(owner.id)).weekly, false);
    assert.equal((await getPrefs(other.id)).weekly, true);
    for (const t of ["v1.bad.link", feedbackToken(other.id, "fb-1")]) assert.equal((await postJson({ t, weekly: false })).status, 400);
    assert.equal((await getPrefs(other.id)).weekly, true);
    g.__testUser = null;
  });

  it("refuses an empty or malformed change", async () => {
    const p = await person();
    const t = stopToken(p.id, "weekly");
    for (const body of [{ t }, { t, weekly: "no" }, null]) assert.equal((await postJson(body)).status, 400);
    assert.equal((await postForm({ t, weekly: "maybe" })).status, 400);
  });
});

describe("taps", () => {
  it("record the first tap on the person's own email, and say the same thing either way", async () => {
    const [p, other] = [await person(), await person()];
    const d = await db();
    await d.insert(schema.emailSends).values({ id: "send-tap-1", userId: p.id, kind: "weekly", dedupeKey: "2026-11-16", localDate: "2026-11-22", status: "sent" });
    const tap = (e: unknown, origin: string | null = SITE) =>
      tapRoute.POST(new Request(`${SITE}/api/email/tap`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ e }) }));

    g.__testUser = null;
    assert.equal((await tap("send-tap-1")).status, 401);

    // Only from our own pages: another site's Origin, or none, changes nothing.
    g.__testUser = { id: p.id, email: p.email };
    assert.equal((await tap("send-tap-1", "https://evil.example")).status, 403);
    assert.equal((await tap("send-tap-1", null)).status, 403);
    assert.equal((await d.select().from(schema.emailSends).where(eq(schema.emailSends.id, "send-tap-1")))[0].firstTapAt, null);

    g.__testUser = { id: other.id, email: other.email };
    const theirs = await tap("send-tap-1");
    assert.deepEqual(await theirs.json(), { ok: true });
    const [untouched] = await d.select().from(schema.emailSends).where(eq(schema.emailSends.id, "send-tap-1"));
    assert.equal(untouched.firstTapAt, null);

    g.__testUser = { id: p.id, email: p.email };
    assert.deepEqual(await (await tap("send-tap-1")).json(), { ok: true });
    const [tapped] = await d.select().from(schema.emailSends).where(eq(schema.emailSends.id, "send-tap-1"));
    assert.ok(tapped.firstTapAt);
    for (const bad of ["", "x".repeat(65), "a b", 7]) assert.equal((await tap(bad)).status, 400);
    g.__testUser = null;
  });
});

// Feedback answers (lane F): the email's links, the /feedback page's data, the API that
// saves answers, the copy to the Google Sheet and account deletion, against a real
// embedded database and a stand-in for the Sheet's web app (fetch is replaced; no real
// Sheet is ever called).
//
// The rules: opening a link records nothing; only a POST saves, once; a link can only
// touch its own person's answers; the Sheet gets a respondent code, never an address
// unless the person agreed; deleting an account deletes its answers here and there.
import assert from "node:assert/strict";
import { after as afterAll, beforeEach, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type AfterFn = () => unknown;
const g = globalThis as unknown as { __testUser?: { id: string; email: string } | null; __after?: AfterFn[] };
allowAppImports({
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null; export const endSession = async () => {};",
  // after() callbacks are collected and run by the test, as Next runs them after the response.
  "next/server": "export const after = (fn) => { (globalThis.__after ??= []).push(fn); }; export const connection = async () => {};",
});
const removeDatabase = tempDatabase();
process.env.EMAIL_LINK_SECRET = "test-email-link-secret";
const SHEET_URL = "https://script.example.test/macros/s/test/exec";
process.env.GOOGLE_SHEETS_WEBHOOK_URL = SHEET_URL;
process.env.GOOGLE_SHEETS_WEBHOOK_SECRET = "test-sheet-secret";

// ── The Sheet's stand-in ────────────────────────────────────────────────────
type SheetCall = { url: string; method: string; body: Record<string, unknown> & { rows?: Record<string, unknown>[] } };
let calls: SheetCall[] = [];
let sheetDown = false;
let duringCall: ((call: SheetCall) => Promise<void>) | null = null;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const call: SheetCall = { url: String(url), method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) };
  calls.push(call);
  if (duringCall) await duringCall(call);
  if (sheetDown) throw new TypeError("fetch failed");
  const reply = call.body.action === "feedback" ? { ok: true, status: "saved", saved: call.body.rows!.length } : { ok: true, status: "forgotten", deleted: 1 };
  return new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
}) as typeof fetch;

const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { feedbackToken, stopToken } = await import("../lib/email/tokens.ts");
const { FEEDBACK_QUESTIONS } = await import("../lib/email/types.ts");
const { ANSWER_LABELS } = await import("../lib/email/templates/feedback.ts");
const survey = await import("../lib/email/feedback-survey.ts");
const fb = await import("../lib/email/feedback.ts");
const route = await import("../app/api/feedback/route.ts");
const deleteRoute = await import("../app/api/account/delete/route.ts");

afterAll(async () => {
  await removeDatabase();
});

beforeEach(() => {
  calls = [];
  sheetDown = false;
  duringCall = null;
  g.__after = [];
  g.__testUser = null;
});

const SITE = "https://www.d-human.fit";
const DAY = 24 * 60 * 60 * 1000;

async function runAfter() {
  const fns = g.__after ?? [];
  g.__after = [];
  for (const fn of fns) await fn();
}

let n = 0;
async function person({ name = "Priya Sharma", onboardedDaysAgo = 10, mealDays = 0 }: { name?: string; onboardedDaysAgo?: number; mealDays?: number } = {}) {
  const d = await db();
  const id = `20000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const email = `fb${n}@example.com`;
  await d.insert(schema.users).values({ id, email });
  await d.insert(schema.profiles).values({ userId: id, name, onboardedAt: new Date(Date.now() - onboardedDaysAgo * DAY) });
  for (let i = 0; i < mealDays; i++) {
    const localDate = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    // Two meals on the first day: days are counted, not meals.
    for (let k = 0; k < (i === 0 ? 2 : 1); k++) {
      await d.insert(schema.foodLogs).values({
        id: `${id.slice(0, 24)}${String(i * 10 + k).padStart(12, "0")}`,
        userId: id,
        localDate,
        meal: "lunch",
        source: "text",
        title: "Dal and rice",
        items: [],
        kcal: 500,
        proteinG: 20,
        carbsG: 70,
        fatG: 10,
        fibreG: 6,
        micros: {},
      });
    }
  }
  return { id, email };
}

async function rows(userId: string) {
  const d = await db();
  return d.select().from(schema.feedbackAnswers).where(eq(schema.feedbackAnswers.userId, userId));
}

// What the page's fetch() sends: JSON from our own origin. `origin: null` leaves the header out.
const post = (body: unknown, origin: string | null = SITE) =>
  route.POST(new Request(`${SITE}/api/feedback`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }));
const postForm = (fields: Record<string, string>) =>
  route.POST(new Request(`${SITE}/api/feedback`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() }));

// ── The survey's words and the email's links ────────────────────────────────

describe("the survey and the email's links", () => {
  it("uses the email's own words for the email's questions, and has words for every option", () => {
    assert.deepEqual(survey.ANSWER_TEXT.feel, ANSWER_LABELS.feel);
    assert.deepEqual(survey.ANSWER_TEXT.gotinway, ANSWER_LABELS.gotinway);
    for (const [q, options] of Object.entries(FEEDBACK_QUESTIONS)) {
      if (options === null) continue;
      assert.deepEqual(Object.keys(survey.ANSWER_TEXT[q as keyof typeof survey.ANSWER_TEXT]), [...options], `labels for ${q}`);
    }
    assert.deepEqual(survey.FLOW.used, ["feel", "use", "build", "nps", "text"]);
    assert.deepEqual(survey.FLOW.barely, ["gotinway", "build", "text"]);
  });

  it("feedbackEmailOptions: one link per answer, all to the page with that answer, carrying the person's own token", async () => {
    const p = await person();
    const options = fb.feedbackEmailOptions(p.id, "fb-1", "feel", SITE);
    assert.deepEqual(
      options.map((o) => o.answer),
      ["very", "somewhat", "not", "not_used"],
    );
    for (const o of options) {
      const url = new URL(o.url);
      assert.equal(url.origin + url.pathname, `${SITE}/feedback`);
      assert.equal(url.searchParams.get("q"), "feel");
      assert.equal(url.searchParams.get("a"), o.answer);
      assert.doesNotMatch(o.url, /@|example\.com/, "no address in the link");
      const state = await fb.feedbackPageState(url.searchParams.get("t"), {});
      assert.equal(state.status, "ok");
    }
  });

  it("nextQuestion: in order, 'Something else' jumps to the box, null at the end", () => {
    assert.equal(survey.nextQuestion("used", "feel"), "use");
    assert.equal(survey.nextQuestion("used", "build", "other"), "text");
    assert.equal(survey.nextQuestion("used", "build", "tests"), "nps");
    assert.equal(survey.nextQuestion("barely", "build", "tests"), "text");
    assert.equal(survey.nextQuestion("used", "text"), null);
  });

  it("checkAnswer: options only from the list; notes cleaned and capped at 1,000 characters", () => {
    assert.deepEqual(survey.checkAnswer("feel", "very"), { ok: true, answer: "very" });
    assert.deepEqual(survey.checkAnswer("feel", "extremely"), { ok: false, error: "bad_answer" });
    assert.deepEqual(survey.checkAnswer("nps", "11"), { ok: false, error: "bad_answer" });
    assert.deepEqual(survey.checkAnswer("text", "  Hindi please\r\nthanks\u0007 "), { ok: true, answer: "Hindi please\nthanks" });
    assert.deepEqual(survey.checkAnswer("text", " \u0000 "), { ok: false, error: "empty" });
    assert.equal(survey.checkAnswer("text", "a".repeat(1000)).ok, true);
    assert.deepEqual(survey.checkAnswer("text", "a".repeat(1001)), { ok: false, error: "too_long" });
    assert.equal(survey.checkAnswer("text", "😀".repeat(1000)).ok, true, "counted as people see them");
  });
});

// ── Tokens ──────────────────────────────────────────────────────────────────

describe("feedback links (tokens)", () => {
  it("a forged, cut, expired or stop link saves nothing", async () => {
    const p = await person();
    const good = feedbackToken(p.id, "fb-1");
    // No link at all falls back to the session, and signed out that's a 401.
    assert.equal((await post({ t: "", question: "feel", answer: "very" })).status, 401);
    const bad = [
      "v1.abc.def",
      good.slice(0, -2),
      `${good.split(".").slice(0, 2).join(".")}.${"A".repeat(43)}`,
      feedbackToken(p.id, "fb-1", Date.now() - 31 * DAY),
      stopToken(p.id, "questions"),
    ];
    for (const t of bad) {
      const res = await post({ t, question: "feel", answer: "very", path: "used", source: "email_tap" });
      assert.equal(res.status, 400, `refused: ${t.slice(0, 20)}`);
      assert.deepEqual(await res.json(), { error: "bad_link" });
      assert.equal((await fb.feedbackPageState(t, { q: "feel", a: "very" })).status, "invalid");
    }
    assert.equal((await rows(p.id)).length, 0);
    assert.equal(g.__after!.length, 0);
  });

  it("a link for a deleted account says so, and saves nothing", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    const d = await db();
    await d.delete(schema.users).where(eq(schema.users.id, p.id));
    assert.equal((await fb.feedbackPageState(t, {})).status, "gone");
    const res = await post({ t, question: "feel", answer: "very", path: "used" });
    assert.equal(res.status, 404);
    assert.equal((await rows(p.id)).length, 0);
  });

  it("a link only ever touches its own person's answers", async () => {
    const a = await person();
    const b = await person();
    await post({ t: feedbackToken(a.id, "fb-1"), question: "feel", answer: "very", path: "used" });
    assert.equal((await rows(a.id)).length, 1);
    assert.equal((await rows(b.id)).length, 0);
    const state = await fb.feedbackPageState(feedbackToken(b.id, "fb-1"), {});
    assert.ok(state.status === "ok" && Object.keys(state.saved).length === 0, "B's page shows none of A's answers");
  });
});

// ── Opening the link ────────────────────────────────────────────────────────

describe("opening the link records nothing", () => {
  it("the page shows the tapped answer as chosen, unsaved, and writes nothing anywhere", async () => {
    const p = await person();
    const d = await db();
    await d.insert(schema.emailSends).values({ id: "30000000-0000-4000-8000-000000000001", userId: p.id, kind: "feedback", dedupeKey: "fb-1", variant: "used", localDate: "2026-11-28", status: "sent" });
    const t = feedbackToken(p.id, "fb-1");
    for (const a of ["very", "somewhat", "not", "not_used"]) {
      const state = await fb.feedbackPageState(t, { q: "feel", a });
      assert.ok(state.status === "ok");
      assert.equal(state.start, "feel");
      assert.equal(state.pending, a);
      assert.deepEqual(state.saved, {});
    }
    assert.equal((await rows(p.id)).length, 0);
    const [send] = await d.select().from(schema.emailSends).where(eq(schema.emailSends.userId, p.id));
    assert.equal(send.firstTapAt, null, "no tap recorded by opening");
    assert.equal(calls.length, 0);
    assert.equal(g.__after!.length, 0);
  });

  it("the API has no GET: only a POST can save", () => {
    assert.equal("GET" in route, false);
  });

  it("an answer that isn't an option, or a question from the other path, isn't shown as chosen", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    const state = await fb.feedbackPageState(t, { q: "feel", a: "=HYPERLINK(1)" });
    assert.ok(state.status === "ok" && state.pending === null && state.start === "feel");
  });

  it("the path comes from the email's question, then the send, and coming back shows saved answers but not the note's words", async () => {
    const p = await person();
    const d = await db();
    await d.insert(schema.emailSends).values({ id: "30000000-0000-4000-8000-000000000002", userId: p.id, kind: "feedback", dedupeKey: "fb-1", variant: "barely", localDate: "2026-11-28", status: "sent" });
    const t = feedbackToken(p.id, "fb-1");
    let state = await fb.feedbackPageState(t, {});
    assert.ok(state.status === "ok" && state.path === "barely" && state.start === "gotinway");

    await post({ t, question: "gotinway", answer: "too_slow", path: "barely", source: "email_tap" });
    await post({ t, question: "text", answer: "My private note about my thyroid", path: "barely" });
    state = await fb.feedbackPageState(t, {});
    assert.ok(state.status === "ok");
    assert.deepEqual(state.saved, { gotinway: "too_slow" });
    assert.equal(state.hasNote, true);
    assert.equal(state.start, "build", "back at the first unanswered question");
    assert.doesNotMatch(JSON.stringify(state), /thyroid/, "the note's words never go back to the page");
    assert.equal(state.firstName, "Priya");
  });
});

// ── Saving ──────────────────────────────────────────────────────────────────

describe("saving answers", () => {
  it("a POST saves once: repeating it changes nothing and copies nothing again", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    const body = { t, question: "feel", answer: "very", path: "used", source: "email_tap" };
    const first = await post(body);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { status: "saved", next: "use" });
    const [row] = await rows(p.id);
    assert.equal(row.answer, "very");
    assert.equal(row.survey, "fb-1");
    assert.equal(row.path, "used");
    assert.equal(row.source, "email_tap");
    assert.equal(row.sheetSyncedAt, null);

    const second = await post(body);
    assert.deepEqual(await second.json(), { status: "unchanged", next: "use" });
    const again = await rows(p.id);
    assert.equal(again.length, 1);
    assert.equal(again[0].id, row.id);
    assert.equal(again[0].updatedAt.getTime(), row.updatedAt.getTime());
    assert.equal(g.__after!.length, 1, "one copy to the Sheet queued, for the first POST only");
  });

  it("changing an answer updates the same row and queues another copy", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "use", answer: "meals", path: "used" });
    await runAfter();
    assert.ok((await rows(p.id))[0].sheetSyncedAt, "copied");
    const res = await post({ t, question: "use", answer: "wraps", path: "used" });
    assert.deepEqual(await res.json(), { status: "saved", next: "build" });
    const [row] = await rows(p.id);
    assert.equal(row.answer, "wraps");
    assert.equal(row.sheetSyncedAt, null, "marked as not copied again");
    assert.equal(g.__after!.length, 1);
  });

  it("refuses answers that aren't options, questions off the path, and notes over 1,000 characters", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    const cases: [Record<string, unknown>, string][] = [
      [{ question: "feel", answer: "extremely" }, "bad_answer"],
      [{ question: "mood", answer: "good" }, "bad_question"],
      [{ question: "use", answer: "meals", path: "barely" }, "bad_question"],
      [{ question: "text", answer: "x".repeat(1001) }, "too_long"],
      [{ question: "text", answer: "   " }, "empty"],
    ];
    for (const [fields, error] of cases) {
      const res = await post({ t, path: "used", ...fields });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error });
    }
    assert.equal((await rows(p.id)).length, 0);
  });

  it("once a survey's path is stored, a different one from the page can't switch it", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "feel", answer: "very", path: "used" });
    const res = await post({ t, question: "gotinway", answer: "too_slow", path: "barely" });
    assert.equal(res.status, 400);
  });

  it("answering from the email records the tap on that person's own send only", async () => {
    const a = await person();
    const b = await person();
    const d = await db();
    const mine = "30000000-0000-4000-8000-000000000010";
    const theirs = "30000000-0000-4000-8000-000000000011";
    await d.insert(schema.emailSends).values([
      { id: mine, userId: a.id, kind: "feedback", dedupeKey: "fb-1", localDate: "2026-11-28", status: "sent" },
      { id: theirs, userId: b.id, kind: "feedback", dedupeKey: "fb-1", localDate: "2026-11-28", status: "sent" },
    ]);
    const t = feedbackToken(a.id, "fb-1");
    await post({ t, question: "feel", answer: "not", path: "used", source: "email_tap", e: theirs });
    await post({ t, question: "feel", answer: "very", path: "used", source: "page", e: mine });
    const tapOf = async (id: string) => (await d.select().from(schema.emailSends).where(eq(schema.emailSends.id, id)))[0].firstTapAt;
    assert.equal(await tapOf(theirs), null, "someone else's send is never touched");
    assert.equal(await tapOf(mine), null, "only an answer from the email counts as a tap");
    await post({ t, question: "feel", answer: "somewhat", path: "used", source: "email_tap", e: mine });
    assert.ok(await tapOf(mine));
  });

  it("two different confirmations from the email within 10 seconds count for neither, until a later single answer", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "feel", answer: "very", path: "used", source: "email_tap" });
    const res = await post({ t, question: "feel", answer: "not", path: "used", source: "email_tap" });
    assert.deepEqual(await res.json(), { status: "conflict", next: null });
    let [row] = await rows(p.id);
    assert.equal(row.answer, null);
    assert.ok(row.conflictUntil && row.conflictUntil.getTime() > Date.now());

    // Another tap from the email inside the window keeps it cleared.
    const still = await fb.saveFeedbackAnswer({ userId: p.id, survey: "fb-1", path: "used", question: "feel", answer: "very", source: "email_tap", now: new Date(Date.now() + 2_000) });
    assert.equal(still.status, "conflict");

    // A single answer after the window counts.
    const later = await fb.saveFeedbackAnswer({ userId: p.id, survey: "fb-1", path: "used", question: "feel", answer: "somewhat", source: "email_tap", now: new Date(Date.now() + 30_000) });
    assert.equal(later.status, "saved");
    [row] = await rows(p.id);
    assert.equal(row.answer, "somewhat");
    assert.equal(row.conflictUntil, null);
  });

  it("a person changing their mind on the page right after confirming is not a conflict", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "feel", answer: "very", path: "used", source: "email_tap" });
    const res = await post({ t, question: "feel", answer: "somewhat", path: "used", source: "page" });
    assert.deepEqual(await res.json(), { status: "saved", next: "use" });
    assert.equal((await rows(p.id))[0].answer, "somewhat");
  });

  it("without JavaScript: a form post saves and goes back to the page at the next question", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    const res = await postForm({ t, question: "feel", answer: "very", path: "used", source: "email_tap" });
    assert.equal(res.status, 303);
    const to = new URL(res.headers.get("location")!);
    assert.equal(to.pathname, "/feedback");
    assert.equal(to.searchParams.get("t"), t);
    assert.equal(to.searchParams.get("at"), "use");
    assert.equal((await rows(p.id))[0].answer, "very");

    const note = await postForm({ t, question: "text", answer: "Hindi please", path: "used", contactOk: "on" });
    assert.equal(new URL(note.headers.get("location")!).searchParams.get("at"), "done");
    const text = (await rows(p.id)).find((r) => r.question === "text")!;
    assert.equal(text.answer, "Hindi please");
    assert.equal(text.contactOk, true);

    const empty = await postForm({ t, question: "text", answer: "", path: "used" });
    assert.equal(new URL(empty.headers.get("location")!).searchParams.get("at"), "done", "Finish with an empty box skips");
  });

  it("a form post needs a link: the session alone never saves (no cross-site forms)", async () => {
    const p = await person();
    g.__testUser = p;
    const res = await postForm({ t: "", question: "build", answer: "tests" });
    assert.equal(res.status, 400);
    assert.equal((await rows(p.id)).length, 0);
  });

  it("from Settings, signed in: saved under the open survey", async () => {
    const p = await person();
    assert.equal((await post({ question: "build", answer: "tests" })).status, 401);
    g.__testUser = p;
    const res = await post({ question: "build", answer: "tests" });
    assert.equal(res.status, 200);
    const [row] = await rows(p.id);
    assert.equal(row.survey, "open");
    assert.equal(row.source, "settings");
    assert.equal(row.path, null);
  });

  it("from Settings, only our own pages can save on the session; a link works from anywhere", async () => {
    const p = await person();
    g.__testUser = p;
    assert.equal((await post({ question: "build", answer: "tests" }, null)).status, 403, "no Origin");
    assert.equal((await post({ question: "build", answer: "tests" }, "https://evil.example")).status, 403, "another site");
    assert.equal((await rows(p.id)).length, 0);
    g.__testUser = null;
    const t = feedbackToken(p.id, "fb-1");
    assert.equal((await post({ t, question: "feel", answer: "very", path: "used" }, null)).status, 200, "the link is the authority");
  });

  it("consent to be emailed is kept only on the note", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "feel", answer: "very", path: "used", contactOk: true });
    assert.equal((await rows(p.id))[0].contactOk, false);
  });
});

// ── The Sheet ───────────────────────────────────────────────────────────────

const ROW_KEYS = ["answerId", "receivedAt", "updatedAt", "survey", "respondent", "path", "question", "answer", "plan", "daysSinceOnboarding", "daysWithMeals", "language", "source", "email"].sort();

describe("the copy in the Google Sheet", () => {
  it("sends the person's rows with the secret, a respondent code and no address unless they agreed", async () => {
    const p = await person({ mealDays: 3, onboardedDaysAgo: 10 });
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "feel", answer: "very", path: "used", source: "email_tap" });
    await post({ t, question: "nps", answer: "9", path: "used" });
    await post({ t, question: "text", answer: "=IMPORTXML(\"x\") Hindi please", path: "used", contactOk: true });
    calls = [];
    await runAfter();

    assert.ok(calls.length >= 1);
    const first = calls[0];
    assert.equal(first.url, SHEET_URL);
    assert.equal(first.method, "POST");
    assert.equal(first.body.secret, "test-sheet-secret");
    assert.equal(first.body.action, "feedback");
    const sent = calls.flatMap((c) => c.body.rows ?? []);
    const byQuestion = Object.fromEntries(sent.map((r) => [r.question, r]));
    for (const r of sent) assert.deepEqual(Object.keys(r).sort(), ROW_KEYS);

    const code = fb.respondentCode(p.id)!;
    assert.match(code, /^r_[0-9a-f]{12}$/);
    for (const r of sent) assert.equal(r.respondent, code);
    assert.equal(byQuestion.feel.answer, "Very disappointed", "the option's words, not its code");
    assert.equal(byQuestion.nps.answer, "9");
    assert.equal(byQuestion.text.answer, "=IMPORTXML(\"x\") Hindi please", "the script escapes formulas; the site sends what was typed");
    assert.equal(byQuestion.feel.email, "");
    assert.equal(byQuestion.nps.email, "");
    assert.equal(byQuestion.text.email, p.email, "only the note they agreed to be emailed about");
    assert.equal(byQuestion.feel.plan, "free");
    assert.equal(byQuestion.feel.daysWithMeals, 3, "days, not meals");
    assert.equal(byQuestion.feel.daysSinceOnboarding, 10);
    assert.equal(byQuestion.feel.language, "en");
    assert.equal(byQuestion.feel.path, "used");
    assert.equal(byQuestion.feel.source, "email_tap");
    assert.equal(byQuestion.feel.survey, "fb-1");
    assert.ok(!Number.isNaN(Date.parse(String(byQuestion.feel.receivedAt))));

    const addressSent = sent.filter((r) => JSON.stringify(r).includes(p.email));
    assert.equal(addressSent.length, 1, "the address is in one row only");
    for (const r of await rows(p.id)) assert.ok(r.sheetSyncedAt, "every row marked as copied");
  });

  it("without consent, no row carries the address or the person's id", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "feel", answer: "not", path: "used" });
    await post({ t, question: "text", answer: "More recipes", path: "used" });
    await runAfter();
    const body = JSON.stringify(calls.map((c) => c.body));
    assert.doesNotMatch(body, new RegExp(p.email.replace(".", "\\.")));
    assert.doesNotMatch(body, new RegExp(p.id));
  });

  it("when the Sheet is down, the rows wait and the daily job copies them later", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "feel", answer: "very", path: "used" });
    sheetDown = true;
    await runAfter();
    assert.equal(calls.length, 1);
    assert.equal((await rows(p.id))[0].sheetSyncedAt, null, "still waiting");

    sheetDown = false;
    calls = [];
    const result = await fb.syncFeedbackSheet();
    assert.equal(result.sync.status, "ok");
    assert.ok(calls.some((c) => c.body.action === "feedback" && c.body.rows!.some((r) => r.respondent === fb.respondentCode(p.id))));
    assert.ok((await rows(p.id))[0].sheetSyncedAt);
  });

  it("an answer changed while its copy was on the way stays waiting for the next copy", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "use", answer: "meals", path: "used" });
    duringCall = async () => {
      duringCall = null;
      await fb.saveFeedbackAnswer({ userId: p.id, survey: "fb-1", path: "used", question: "use", answer: "stack", source: "page", now: new Date(Date.now() + 1_000) });
    };
    await runAfter();
    const [row] = await rows(p.id);
    assert.equal(row.answer, "stack");
    assert.equal(row.sheetSyncedAt, null, "the newer answer isn't marked as copied");
  });

  it("does nothing without the Sheet's URL and secret", async () => {
    const p = await person();
    await post({ t: feedbackToken(p.id, "fb-1"), question: "feel", answer: "very", path: "used" });
    const saved = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    delete process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    try {
      await runAfter();
      assert.deepEqual(await fb.syncFeedback({ userId: p.id }), { status: "not_configured" });
      assert.equal(calls.length, 0);
    } finally {
      process.env.GOOGLE_SHEETS_WEBHOOK_URL = saved;
    }
  });

  it("respondent codes are stable per person and differ between people", async () => {
    const a = await person();
    const b = await person();
    assert.equal(fb.respondentCode(a.id), fb.respondentCode(a.id));
    assert.notEqual(fb.respondentCode(a.id), fb.respondentCode(b.id));
  });
});

// ── Account deletion ────────────────────────────────────────────────────────

describe("deleting an account", () => {
  it("deletes the answers here and asks the Sheet to forget that respondent", async () => {
    const p = await person();
    const t = feedbackToken(p.id, "fb-1");
    await post({ t, question: "feel", answer: "very", path: "used" });
    await post({ t, question: "text", answer: "Hindi please", path: "used", contactOk: true });
    await runAfter();
    const code = fb.respondentCode(p.id)!;

    g.__testUser = p;
    calls = [];
    const res = await deleteRoute.POST(new Request(`${SITE}/api/account/delete`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ confirm: "DELETE" }) }));
    assert.equal(res.status, 200);
    assert.equal((await rows(p.id)).length, 0, "answers deleted with the account");
    assert.equal(calls.length, 0, "the Sheet is asked after the response");
    await runAfter();
    assert.deepEqual(
      calls.map((c) => c.body),
      [{ secret: "test-sheet-secret", action: "forget", respondent: code }],
    );
    // The old link now shows the account is gone.
    assert.equal((await fb.feedbackPageState(t, {})).status, "gone");
  });

  it("a forget the Sheet missed is kept and finished by the daily job", async () => {
    const p = await person();
    const code = fb.respondentCode(p.id)!;
    sheetDown = true;
    assert.equal(await fb.forgetFeedbackInSheet(code, { tries: 2, waitMs: 0 }), "queued");
    assert.equal(calls.length, 2, "tried twice");
    const d = await db();
    const marker = await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, `sheet-forget:${code}`));
    assert.equal(marker.length, 1);

    sheetDown = false;
    calls = [];
    const result = await fb.syncFeedbackSheet();
    assert.equal(result.forgotten, 1);
    assert.ok(calls.some((c) => c.body.action === "forget" && c.body.respondent === code));
    assert.equal((await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, `sheet-forget:${code}`))).length, 0, "marker gone");
  });

  it("the daily catch-up stops at the first forget the Sheet refuses, and keeps the rest for the next run", async () => {
    const codes = [fb.respondentCode((await person()).id)!, fb.respondentCode((await person()).id)!];
    const d = await db();
    const markers = codes.map((c) => `sheet-forget:${c}`);
    await d.insert(schema.jobRuns).values(markers.map((job, i) => ({ job, lastStartedAt: new Date(Date.now() - (2 - i) * 60_000) })));
    sheetDown = true;
    const down = await fb.syncFeedbackSheet();
    assert.equal(calls.filter((c) => c.body.action === "forget").length, 1, "one try, not one per marker");
    assert.equal(down.forgotten, 0);
    for (const job of markers) assert.equal((await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, job))).length, 1, `${job} kept`);

    sheetDown = false;
    calls = [];
    const up = await fb.syncFeedbackSheet();
    assert.equal(up.forgotten, 2);
    assert.deepEqual(new Set(calls.filter((c) => c.body.action === "forget").map((c) => c.body.respondent)), new Set(codes));
  });

  it("rows that reach the Sheet after the account was deleted are forgotten again", async () => {
    const p = await person();
    await post({ t: feedbackToken(p.id, "fb-1"), question: "feel", answer: "very", path: "used" });
    const d = await db();
    duringCall = async (call) => {
      if (call.body.action !== "feedback") return;
      duringCall = null;
      await d.delete(schema.users).where(eq(schema.users.id, p.id));
    };
    await runAfter();
    assert.deepEqual(
      calls.map((c) => c.body.action),
      ["feedback", "forget"],
    );
    assert.equal(calls[1].body.respondent, fb.respondentCode(p.id));
    const left = await d.select().from(schema.feedbackAnswers).where(and(eq(schema.feedbackAnswers.userId, p.id)));
    assert.equal(left.length, 0);
  });
});

// google-apps-script/Code.gs, run in a sandbox against stand-ins for Google's services
// (tests/support/apps-script.ts). Covers the Feedback tab's "feedback" and "forget"
// actions, setupFeedback, the Users tab's "users", "users-forget" and "users-ids" actions
// and setupUsers, the formula escaping every value goes through, and that the waitlist's
// "join" and "update" still behave as before. The real Sheet is never called; Mayank
// pastes the script by hand.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SECRET, isDate, loadScript } from "./support/apps-script.ts";

const load = loadScript;

const RESPONDENT = "r_0123456789ab";
function answer(over: Record<string, unknown> = {}) {
  return {
    answerId: "6f1c2b9e-0000-4000-8000-000000000001",
    receivedAt: "2026-11-28T05:34:00.000Z",
    updatedAt: "2026-11-28T05:34:00.000Z",
    survey: "fb-1",
    respondent: RESPONDENT,
    path: "used",
    question: "feel",
    answer: "Very disappointed",
    plan: "free",
    daysSinceOnboarding: 10,
    daysWithMeals: 7,
    language: "en",
    source: "email_tap",
    email: "",
    ...over,
  };
}
const HEADER = ["Answer ID", "Received at", "Updated at", "Survey", "Respondent", "Path", "Question", "Answer", "Plan", "Days since onboarding", "Days with meals logged", "Language", "Source", "Email"];
const col = (name: string) => HEADER.indexOf(name);

describe("clean_: formula escaping and length", () => {
  const { script } = load();

  it("stores anything a spreadsheet could run as plain text", () => {
    for (const evil of ["=IMPORTXML(\"https://x.test\",\"//a\")", "+1+1", "-2+3", "@SUM(A1)", "=HYPERLINK(\"https://x.test\",\"tap\")"]) {
      assert.equal(script.clean_(evil), `'${evil}`);
    }
    // Leading whitespace is trimmed first, so it can't hide a formula.
    assert.equal(script.clean_("  \t=1+1"), "'=1+1");
    assert.equal(script.clean_("\n=1+1"), "'=1+1");
  });

  it("keeps leading zeros and leaves ordinary words alone", () => {
    assert.equal(script.clean_("09876 54321"), "'09876 54321");
    assert.equal(script.clean_("Very disappointed"), "Very disappointed");
    assert.equal(script.clean_(null), "");
    assert.equal(script.clean_(undefined), "");
  });

  it("cuts at 500 by default, or at the given length, by characters people see", () => {
    assert.equal(script.clean_("a".repeat(600)).length, 500);
    assert.equal(script.clean_("a".repeat(1200), 1000).length, 1000);
    const emoji = "😀".repeat(1000);
    assert.equal(Array.from(script.clean_(emoji, 1000)).length, 1000, "1,000 emoji survive whole");
  });
});

describe("feedback action", () => {
  it("refuses a wrong or missing secret and writes nothing", () => {
    const { ss, post } = load();
    assert.deepEqual(post({ secret: "nope", action: "feedback", rows: [answer()] }), { ok: false, error: "unauthorized" });
    assert.deepEqual(post({ action: "feedback", rows: [answer()] }), { ok: false, error: "unauthorized" });
    assert.equal(ss.getSheetByName("Feedback"), null);
    const unset = load({ secret: null });
    assert.deepEqual(unset.post({ secret: "", action: "feedback", rows: [answer()] }), { ok: false, error: "unauthorized" });
  });

  it("refuses junk bodies", () => {
    const { post } = load();
    assert.deepEqual(post("not json"), { ok: false, error: "bad_json" });
    assert.deepEqual(post("null"), { ok: false, error: "bad_json" });
  });

  it("makes the tab with its headers, then appends one row per answer", () => {
    const { ss, post } = load();
    const res = post({ secret: SECRET, action: "feedback", rows: [answer(), answer({ answerId: "id-2", question: "use", answer: "Logging meals", source: "page" })] });
    assert.deepEqual(res, { ok: true, status: "saved", saved: 2 });
    const tab = ss.getSheetByName("Feedback")!;
    assert.deepEqual([...tab.data[0]], HEADER);
    const rows = tab.body();
    assert.equal(rows.length, 2);
    assert.ok(isDate(rows[0][col("Received at")]) && isDate(rows[0][col("Updated at")]));
    assert.equal(rows[0][col("Respondent")], RESPONDENT);
    assert.equal(rows[0][col("Answer")], "Very disappointed");
    assert.equal(rows[0][col("Days since onboarding")], 10);
    assert.equal(rows[0][col("Days with meals logged")], 7);
    assert.equal(rows[0][col("Email")], "");
  });

  it("updates the row with the same Answer ID instead of adding another", () => {
    const { ss, post } = load();
    post({ secret: SECRET, action: "feedback", rows: [answer()] });
    post({ secret: SECRET, action: "feedback", rows: [answer({ answer: "Somewhat disappointed", updatedAt: "2026-11-29T05:34:00.000Z", source: "page" })] });
    const rows = ss.getSheetByName("Feedback")!.body();
    assert.equal(rows.length, 1);
    assert.equal(rows[0][col("Answer")], "Somewhat disappointed");
    assert.equal(rows[0][col("Source")], "page");
  });

  it("escapes typed answers and keeps 1,000 characters of them", () => {
    const { ss, post } = load();
    const note = "=IMPORTRANGE(\"x\",\"A1\") " + "b".repeat(1500);
    post({ secret: SECRET, action: "feedback", rows: [answer({ question: "text", answer: note, email: "+priya@example.com" })] });
    const [row] = ss.getSheetByName("Feedback")!.body();
    const saved = String(row[col("Answer")]);
    assert.ok(saved.startsWith("'=IMPORTRANGE"), "a formula is stored as text");
    assert.equal(saved.length, 1001, "1,000 characters plus the apostrophe");
    assert.equal(row[col("Email")], "'+priya@example.com");
    for (const cell of row) if (typeof cell === "string") assert.doesNotMatch(cell, /^[=+\-@]/, "no cell starts like a formula");
  });

  it("checks every row before writing any", () => {
    const { ss, post } = load();
    assert.deepEqual(post({ secret: SECRET, action: "feedback", rows: [answer(), answer({ answerId: "x", respondent: "priya@example.com" })] }), { ok: false, error: "bad_row" });
    assert.deepEqual(post({ secret: SECRET, action: "feedback", rows: [answer({ answerId: "=1+1" })] }), { ok: false, error: "bad_row" });
    assert.deepEqual(post({ secret: SECRET, action: "feedback", rows: [] }), { ok: false, error: "bad_rows" });
    assert.deepEqual(post({ secret: SECRET, action: "feedback", rows: "nope" }), { ok: false, error: "bad_rows" });
    assert.deepEqual(post({ secret: SECRET, action: "feedback", rows: Array.from({ length: 201 }, (_, i) => answer({ answerId: `id-${i}` })) }), { ok: false, error: "bad_rows" });
    assert.equal(ss.getSheetByName("Feedback"), null);
  });

  it("answers busy when the lock is held", () => {
    const { post } = load({ lockFree: false });
    assert.deepEqual(post({ secret: SECRET, action: "feedback", rows: [answer()] }), { ok: false, error: "busy" });
  });
});

describe("forget action", () => {
  it("deletes every Feedback and Replies row for that respondent, and nobody else's", () => {
    const { ss, post, script } = load();
    script.setupFeedback();
    const other = "r_ffffffffffff";
    post({
      secret: SECRET,
      action: "feedback",
      rows: [answer({ answerId: "a1" }), answer({ answerId: "a2", respondent: other }), answer({ answerId: "a3", question: "use" }), answer({ answerId: "a4", question: "text" })],
    });
    const replies = ss.getSheetByName("Replies")!;
    replies.appendRow(["2026-11-28", "someone@example.com", "Re: Two taps", "Hello", RESPONDENT, "new"]);
    replies.appendRow(["2026-11-28", "other@example.com", "Re: Two taps", "Hi", other, "new"]);

    assert.deepEqual(post({ secret: SECRET, action: "forget", respondent: RESPONDENT }), { ok: true, status: "forgotten", deleted: 4 });
    const left = ss.getSheetByName("Feedback")!.body();
    assert.deepEqual(
      left.map((r) => r[col("Answer ID")]),
      ["a2"],
    );
    assert.deepEqual(
      replies.body().map((r) => r[4]),
      [other],
    );
    // Again: nothing left to delete, still fine.
    assert.deepEqual(post({ secret: SECRET, action: "forget", respondent: RESPONDENT }), { ok: true, status: "forgotten", deleted: 0 });
  });

  it("refuses anything but a respondent code, and works before the tabs exist", () => {
    const { post } = load();
    for (const respondent of ["", "priya@example.com", "r_123", "r_0123456789abcd", null]) {
      assert.deepEqual(post({ secret: SECRET, action: "forget", respondent }), { ok: false, error: "bad_respondent" });
    }
    assert.deepEqual(post({ secret: SECRET, action: "forget", respondent: RESPONDENT }), { ok: true, status: "forgotten", deleted: 0 });
  });

  it("needs the secret", () => {
    const { post } = load();
    assert.deepEqual(post({ secret: "nope", action: "forget", respondent: RESPONDENT }), { ok: false, error: "unauthorized" });
  });
});

describe("setupFeedback", () => {
  it("builds both tabs, and running it again keeps the data", () => {
    const { ss, script, post, logs } = load();
    script.setupFeedback();
    const feedback = ss.getSheetByName("Feedback")!;
    const replies = ss.getSheetByName("Replies")!;
    assert.deepEqual([...feedback.data[0]], HEADER);
    assert.deepEqual([...replies.data[0]], ["Received at", "From", "Subject", "Reply", "Respondent", "Status"]);
    assert.equal(feedback.frozen, 1);
    assert.ok(feedback.filter && replies.filter);
    assert.ok(logs.some((l) => /WEBHOOK_SECRET is set/.test(l)));

    post({ secret: SECRET, action: "feedback", rows: [answer()] });
    script.setupFeedback();
    assert.equal(feedback.body().length, 1);
  });

  it("stops rather than overwrite a tab whose headers differ with data below", () => {
    const { ss, script } = load();
    const tab = ss.insertSheet("Feedback");
    tab.appendRow(["Something", "Else"]);
    tab.appendRow(["kept", "data"]);
    assert.throws(() => script.setupFeedback(), /different headers/);
    assert.deepEqual([...tab.data[1]], ["kept", "data"]);
  });

  it("leaves the Waitlist tab alone", () => {
    const { ss, script } = load();
    script.setupFeedback();
    assert.equal(ss.getSheetByName("Waitlist"), null);
  });
});

describe("the waitlist still works as before", () => {
  it("join adds a row once, update fills details, and the email is required", () => {
    const { ss, post } = load();
    assert.deepEqual(post({ secret: SECRET, action: "join", email: "Priya@Example.com", source: "landing" }), { ok: true, status: "created" });
    assert.deepEqual(post({ secret: SECRET, action: "join", email: "priya@example.com", source: "landing" }), { ok: true, status: "exists" });
    assert.deepEqual(post({ secret: SECRET, action: "update", email: "priya@example.com", firstName: "=Priya", city: "Indore" }), { ok: true, status: "updated" });
    const tab = ss.getSheetByName("Waitlist")!;
    const [row] = tab.body();
    assert.equal(row[1], "priya@example.com");
    assert.equal(row[7], "'=Priya");
    assert.equal(row[8], "Indore");
    assert.deepEqual(post({ secret: SECRET, action: "join" }), { ok: false, error: "missing_email" });
    assert.deepEqual(post({ secret: SECRET, action: "update", email: "nobody@example.com" }), { ok: false, error: "not_found" });
    assert.deepEqual(post({ secret: SECRET, action: "dance", email: "priya@example.com" }), { ok: false, error: "unknown_action" });
    assert.equal(ss.getSheetByName("Feedback"), null, "waitlist calls never touch the Feedback tab");
  });

  it("doGet says the deployed version has the feedback and users actions", () => {
    const { script } = load();
    assert.deepEqual(JSON.parse(script.doGet().text), { ok: true, service: "d-human-waitlist", feedback: true, users: true });
  });
});

// ── The Users tab ───────────────────────────────────────────────────────────

const USER_HEADER = [
  "User ID",
  "Founder",
  "Name",
  "Email",
  "Signed up (IST)",
  "Onboarding finished (IST)",
  "Last active (IST)",
  "Language",
  "City",
  "Age",
  "Sex",
  "Main activity",
  "Level",
  "Goals",
  "Diet",
  "Plan",
  "Payments",
  "Meals logged",
  "Reports uploaded",
  "Weekly email",
  "Synced (IST)",
];
const ucol = (name: string) => USER_HEADER.indexOf(name);
const uid = (n: number) => `u_${n.toString(16).padStart(12, "0")}`;
function user(n: number, over: Record<string, unknown> = {}) {
  return {
    id: uid(n),
    founder: "No",
    name: `Asha ${n}`,
    email: `asha${n}@example.com`,
    signedUp: "2026-11-20 09:15",
    onboarded: "2026-11-20 09:30",
    lastActive: "2026-11-24 21:05",
    language: "English",
    city: "Indore",
    age: 31,
    sex: "Female",
    activity: "Running",
    level: "Regular",
    goals: "More energy, Lose fat",
    diet: "Vegetarian",
    plan: "Free",
    payments: 0,
    meals: 12,
    reports: 1,
    weeklyEmail: "On",
    synced: "2026-11-25 10:31",
    ...over,
  };
}
const users = (ss: ReturnType<typeof load>["ss"]) => ss.getSheetByName("Users")!;

describe("users action", () => {
  it("refuses a wrong or missing secret and writes nothing", () => {
    const { ss, post } = load();
    assert.deepEqual(post({ secret: "nope", action: "users", rows: [user(1)] }), { ok: false, error: "unauthorized" });
    assert.deepEqual(post({ action: "users", rows: [user(1)] }), { ok: false, error: "unauthorized" });
    assert.equal(ss.getSheetByName("Users"), null);
  });

  it("makes the tab with its headers, then adds the rows in the order sent, in one write", () => {
    const { ss, post } = load();
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: [user(1), user(2), user(3)] }), { ok: true, status: "saved", saved: 3, added: 3 });
    const tab = users(ss);
    assert.deepEqual([...tab.data[0]], USER_HEADER);
    const rows = tab.body();
    assert.deepEqual(
      rows.map((r) => r[ucol("User ID")]),
      [uid(1), uid(2), uid(3)],
    );
    assert.equal(tab.writes, 1, "three new rows, one write");
    const [first] = rows;
    assert.equal(first[ucol("Name")], "Asha 1");
    assert.equal(first[ucol("Email")], "asha1@example.com");
    assert.equal(first[ucol("Age")], 31);
    assert.equal(first[ucol("Meals logged")], 12);
    assert.equal(first[ucol("Plan")], "Free");
    assert.equal(first[ucol("Weekly email")], "On");
  });

  it("dates are real dates showing the Indian clock time, read in the spreadsheet's own time zone", () => {
    const { ss, post, parsed } = load({ timeZone: "America/New_York" });
    post({ secret: SECRET, action: "users", rows: [user(1, { onboarded: "" })] });
    const [row] = users(ss).body();
    for (const name of ["Signed up (IST)", "Last active (IST)", "Synced (IST)"]) assert.ok(isDate(row[ucol(name)]), name);
    // The stand-in returns the clock time as UTC, so this is exactly what the cell shows.
    assert.equal((row[ucol("Signed up (IST)")] as Date).toISOString(), "2026-11-20T09:15:00.000Z");
    assert.equal(row[ucol("Onboarding finished (IST)")], "", "blank when onboarding isn't finished");
    assert.ok(parsed.length >= 3 && parsed.every((p) => p.tz === "America/New_York" && p.format === "yyyy-MM-dd HH:mm"));
    // Anything but the site's own format is left blank, never guessed.
    post({ secret: SECRET, action: "users", rows: [user(2, { signedUp: "=NOW()", lastActive: "2026-11-24T21:05:00Z" })] });
    const second = users(ss).body()[1];
    assert.equal(second[ucol("Signed up (IST)")], "");
    assert.equal(second[ucol("Last active (IST)")], "");
  });

  it("updates the row with the same User ID, leaves notes to its right, and writes neighbours together", () => {
    const { ss, post } = load();
    post({ secret: SECRET, action: "users", rows: [1, 2, 3, 4, 5].map((n) => user(n)) });
    const tab = users(ss);
    tab.set(3, USER_HEADER.length + 1, "called on Monday"); // a founder's note beside account 2
    tab.writes = 0;
    const res = post({ secret: SECRET, action: "users", rows: [user(2, { meals: 40, plan: "Pass until 04 Dec 2026" }), user(3, { meals: 9 }), user(5, { city: "Pune" })] });
    assert.deepEqual(res, { ok: true, status: "saved", saved: 3, added: 0 });
    const rows = tab.body();
    assert.equal(rows.length, 5, "no duplicates");
    assert.equal(rows[1][ucol("Meals logged")], 40);
    assert.equal(rows[1][ucol("Plan")], "Pass until 04 Dec 2026");
    assert.equal(rows[1][USER_HEADER.length], "called on Monday", "the note stays");
    assert.equal(rows[2][ucol("Meals logged")], 9);
    assert.equal(rows[4][ucol("City")], "Pune");
    assert.equal(tab.writes, 2, "rows 2 and 3 in one write, row 5 in another");
  });

  it("finds rows by User ID after the founders sort the tab", () => {
    const { ss, post } = load();
    post({ secret: SECRET, action: "users", rows: [user(1), user(2), user(3)] });
    const tab = users(ss);
    const [header, ...body] = tab.data;
    tab.data = [header, ...body.reverse()];
    post({ secret: SECRET, action: "users", rows: [user(1, { name: "Asha Rao" })] });
    const rows = tab.body();
    assert.deepEqual(
      rows.map((r) => r[ucol("User ID")]),
      [uid(3), uid(2), uid(1)],
    );
    assert.equal(rows[2][ucol("Name")], "Asha Rao");
  });

  it("the same account twice in one batch: one row, the later values", () => {
    const { ss, post } = load();
    post({ secret: SECRET, action: "users", rows: [user(1, { meals: 1 }), user(1, { meals: 2 })] });
    assert.deepEqual(
      users(ss)
        .body()
        .map((r) => r[ucol("Meals logged")]),
      [2],
    );
    post({ secret: SECRET, action: "users", rows: [user(1, { meals: 3 }), user(1, { meals: 4 })] });
    assert.deepEqual(
      users(ss)
        .body()
        .map((r) => r[ucol("Meals logged")]),
      [4],
    );
  });

  it("escapes anything a person typed that a spreadsheet could run", () => {
    const { ss, post } = load();
    post({ secret: SECRET, action: "users", rows: [user(1, { name: '=HYPERLINK("https://x.test","tap")', email: "+priya@example.com", city: "@SUM(A1)" })] });
    const [row] = users(ss).body();
    assert.equal(row[ucol("Name")], '\'=HYPERLINK("https://x.test","tap")');
    assert.equal(row[ucol("Email")], "'+priya@example.com");
    assert.equal(row[ucol("City")], "'@SUM(A1)");
    for (const cell of row) if (typeof cell === "string") assert.doesNotMatch(cell, /^[=+\-@]/, "no cell starts like a formula");
  });

  it("checks every row before writing any", () => {
    const { ss, post } = load();
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: [user(1), user(2, { id: "priya@example.com" })] }), { ok: false, error: "bad_row" });
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: [user(1, { id: "=1+1" })] }), { ok: false, error: "bad_row" });
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: [null] }), { ok: false, error: "bad_row" });
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: [] }), { ok: false, error: "bad_rows" });
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: "nope" }), { ok: false, error: "bad_rows" });
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: Array.from({ length: 201 }, (_, i) => user(i)) }), { ok: false, error: "bad_rows" });
    assert.equal(ss.getSheetByName("Users"), null);
  });

  it("takes 200 rows, and grows the tab past its last row", () => {
    const { ss, post } = load();
    const tab = ss.insertSheet("Users");
    tab.appendRow(USER_HEADER);
    tab.maxRows = 50;
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: Array.from({ length: 200 }, (_, i) => user(i + 1)) }), { ok: true, status: "saved", saved: 200, added: 200 });
    assert.equal(tab.body().length, 200);
    assert.ok(tab.getMaxRows() >= 201);
  });

  it("refuses to write under headers someone moved or renamed", () => {
    const { ss, post } = load();
    post({ secret: SECRET, action: "users", rows: [user(1)] });
    const tab = users(ss);
    tab.data[0][ucol("Name")] = "Full name";
    const before = JSON.stringify(tab.data);
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: [user(1, { meals: 99 })] }), { ok: false, error: "headers_changed" });
    assert.equal(JSON.stringify(tab.data), before);
  });

  it("answers busy when the lock is held", () => {
    const { post } = load({ lockFree: false });
    assert.deepEqual(post({ secret: SECRET, action: "users", rows: [user(1)] }), { ok: false, error: "busy" });
  });

  it("never touches the other tabs", () => {
    const { ss, post } = load();
    post({ secret: SECRET, action: "users", rows: [user(1)] });
    assert.deepEqual([...ss.sheets.keys()], ["Users"]);
  });
});

describe("users-forget action", () => {
  it("deletes every row with those User IDs, and nobody else's", () => {
    const { ss, post } = load();
    post({ secret: SECRET, action: "users", rows: [user(1), user(2), user(3), user(4)] });
    users(ss).appendRow([uid(2), "No", "copied by hand"]);
    assert.deepEqual(post({ secret: SECRET, action: "users-forget", ids: [uid(2), uid(4), uid(99)] }), { ok: true, status: "forgotten", deleted: 3 });
    assert.deepEqual(
      users(ss)
        .body()
        .map((r) => r[ucol("User ID")]),
      [uid(1), uid(3)],
    );
    assert.deepEqual(post({ secret: SECRET, action: "users-forget", ids: [uid(2)] }), { ok: true, status: "forgotten", deleted: 0 });
  });

  it("removes the last row even when the tab has no spare row below it", () => {
    const { ss, post } = load();
    const tab = ss.insertSheet("Users");
    tab.appendRow(USER_HEADER);
    tab.setFrozenRows(1);
    tab.maxRows = 2;
    post({ secret: SECRET, action: "users", rows: [user(1)] });
    assert.deepEqual(post({ secret: SECRET, action: "users-forget", ids: [uid(1)] }), { ok: true, status: "forgotten", deleted: 1 });
    assert.equal(tab.body().length, 0);
  });

  it("refuses anything but User IDs, and works before the tab exists", () => {
    const { post } = load();
    for (const ids of [[], "u_000000000001", ["priya@example.com"], ["u_123"], [null], Array.from({ length: 501 }, (_, i) => uid(i))]) {
      const res = post({ secret: SECRET, action: "users-forget", ids });
      assert.equal(res.ok, false, JSON.stringify(ids).slice(0, 40));
    }
    assert.deepEqual(post({ secret: SECRET, action: "users-forget", ids: [uid(1)] }), { ok: true, status: "forgotten", deleted: 0 });
    assert.deepEqual(post({ secret: "nope", action: "users-forget", ids: [uid(1)] }), { ok: false, error: "unauthorized" });
  });
});

describe("users-ids action", () => {
  it("lists the User IDs in the tab, and nothing else from it", () => {
    const { ss, post } = load();
    assert.deepEqual(post({ secret: SECRET, action: "users-ids" }), { ok: true, status: "listed", ids: [] });
    post({ secret: SECRET, action: "users", rows: [user(1), user(2)] });
    users(ss).appendRow(["a note row", "", "Someone"]);
    assert.deepEqual(post({ secret: SECRET, action: "users-ids" }), { ok: true, status: "listed", ids: [uid(1), uid(2)] });
    assert.deepEqual(post({ secret: "nope", action: "users-ids" }), { ok: false, error: "unauthorized" });
  });
});

describe("setupUsers", () => {
  it("builds the tab with a filter over every column, and running it again keeps the data", () => {
    const { ss, script, post, logs } = load();
    script.setupUsers();
    const tab = users(ss);
    assert.deepEqual([...tab.data[0]], USER_HEADER);
    assert.equal(tab.frozen, 1);
    assert.equal(tab.filter?.cols, 26, "sorting moves notes kept to the right with their rows");
    assert.ok(tab.getMaxRows() >= 5000 && tab.filter!.rows >= 5000, "the filter covers accounts added later");
    assert.ok(logs.some((l) => /WEBHOOK_SECRET is set/.test(l)));
    assert.ok(logs.some((l) => /Indian time \(IST\)/.test(l)));
    post({ secret: SECRET, action: "users", rows: [user(1)] });
    script.setupUsers();
    assert.equal(tab.body().length, 1);
  });

  it("stops rather than overwrite a tab whose headers differ with data below", () => {
    const { ss, script } = load();
    const tab = ss.insertSheet("Users");
    tab.appendRow(["Something", "Else"]);
    tab.appendRow(["kept", "data"]);
    assert.throws(() => script.setupUsers(), /different headers.*run setupUsers again/);
    assert.deepEqual([...tab.data[1]], ["kept", "data"]);
  });

  it("leaves the Waitlist, Feedback and Replies tabs alone", () => {
    const { ss, script } = load();
    script.setupUsers();
    assert.deepEqual([...ss.sheets.keys()], ["Users"]);
  });

  it("the old setupFeedback still names itself when it stops", () => {
    const { ss, script } = load();
    const tab = ss.insertSheet("Feedback");
    tab.appendRow(["Something"]);
    tab.appendRow(["kept"]);
    assert.throws(() => script.setupFeedback(), /run setupFeedback again/);
  });
});

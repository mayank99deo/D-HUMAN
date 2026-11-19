// google-apps-script/Code.gs, run in a sandbox against stand-ins for Google's services
// (Sheets, script properties, the lock, ContentService). Covers the Feedback tab's
// "feedback" and "forget" actions, setupFeedback, the formula escaping every value goes
// through, and that the waitlist's "join" and "update" still behave as before.
// The real Sheet is never called; Mayank pastes the script by hand.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../google-apps-script/Code.gs"), "utf8");
const SECRET = "test-webhook-secret";

class FakeRange {
  sheet: FakeSheet;
  row: number;
  col: number;
  rows: number;
  cols: number;
  constructor(sheet: FakeSheet, row: number, col: number, rows = 1, cols = 1) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.rows = rows;
    this.cols = cols;
  }
  getValues() {
    return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.cols }, (_, c) => this.sheet.cell(this.row + r, this.col + c)));
  }
  setValues(values: unknown[][]) {
    assert.equal(values.length, this.rows, "setValues: row count matches the range");
    values.forEach((line, r) => {
      assert.equal(line.length, this.cols, "setValues: column count matches the range");
      line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v));
    });
    return this;
  }
  setValue(v: unknown) {
    this.sheet.set(this.row, this.col, v);
    return this;
  }
  setFontWeight() {
    return this;
  }
  setBackground() {
    return this;
  }
  setFontColor() {
    return this;
  }
  setNumberFormat() {
    return this;
  }
  setWrap() {
    return this;
  }
  createFilter() {
    this.sheet.filter = {};
    return this.sheet.filter;
  }
}

class FakeSheet {
  data: unknown[][] = [];
  filter: object | null = null;
  frozen = 0;
  maxRows = 1000;
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  cell(r: number, c: number) {
    return this.data[r - 1]?.[c - 1] ?? "";
  }
  set(r: number, c: number, v: unknown) {
    while (this.data.length < r) this.data.push([]);
    this.data[r - 1][c - 1] = v;
  }
  getLastRow() {
    let n = this.data.length;
    while (n > 0 && this.data[n - 1].every((v) => v === "" || v === undefined)) n--;
    return n;
  }
  getMaxRows() {
    return Math.max(this.maxRows, this.data.length);
  }
  getRange(r: number, c: number, rows = 1, cols = 1) {
    return new FakeRange(this, r, c, rows, cols);
  }
  appendRow(values: unknown[]) {
    const r = this.getLastRow() + 1;
    values.forEach((v, i) => this.set(r, i + 1, v));
  }
  deleteRow(r: number) {
    this.data.splice(r - 1, 1);
  }
  setFrozenRows(n: number) {
    this.frozen = n;
  }
  setColumnWidth() {}
  insertRowsAfter(_after: number, n: number) {
    this.maxRows += n;
  }
  getFilter() {
    return this.filter;
  }
  /** Rows below the header, as plain arrays. */
  body() {
    return this.data.slice(1, this.getLastRow()).map((row) => [...row]);
  }
}

class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>();
  getSheetByName(name: string) {
    return this.sheets.get(name) ?? null;
  }
  insertSheet(name: string) {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

type Script = {
  doPost(e: { postData: { contents: string } }): { text: string };
  doGet(): { text: string };
  setup(): void;
  setupFeedback(): void;
  clean_(value: unknown, max?: number): string;
};

function load({ secret = SECRET as string | null, lockFree = true } = {}) {
  const ss = new FakeSpreadsheet();
  const logs: string[] = [];
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => (k === "WEBHOOK_SECRET" ? secret : null) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockFree, waitLock() {}, releaseLock() {} }) },
    ContentService: {
      createTextOutput: (text: string) => ({
        text,
        setMimeType() {
          return this;
        },
      }),
      MimeType: { JSON: "application/json" },
    },
    Logger: { log: (m: unknown) => logs.push(String(m)) },
    console,
  };
  const script = vm.runInContext(`${SOURCE}\n;({ doPost, doGet, setup, setupFeedback, clean_ });`, vm.createContext(sandbox)) as Script;
  const post = (body: unknown) => JSON.parse(script.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).text);
  return { ss, script, post, logs };
}

const isDate = (v: unknown) => Object.prototype.toString.call(v) === "[object Date]";

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

  it("doGet says the deployed version has the feedback actions", () => {
    const { script } = load();
    assert.deepEqual(JSON.parse(script.doGet().text), { ok: true, service: "d-human-waitlist", feedback: true });
  });
});

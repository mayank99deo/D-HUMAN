// google-apps-script/Code.gs, run in a sandbox against stand-ins for Google's services
// (Sheets, script properties, the lock, ContentService, Utilities). tests/apps-script.test.ts
// tests the script itself; tests/users-sheet.test.ts uses it as the Sheet's web app, so the
// site's requests land in the real script. The real Sheet is never called; Mayank pastes
// the script by hand.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../google-apps-script/Code.gs"), "utf8");
export const SECRET = "test-webhook-secret";

export class FakeRange {
  sheet: FakeSheet;
  row: number;
  col: number;
  rows: number;
  cols: number;
  constructor(sheet: FakeSheet, row: number, col: number, rows = 1, cols = 1) {
    assert.ok(rows >= 1 && cols >= 1, "getRange: Sheets refuses a range with no rows or columns");
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
    // Real Sheets: "The coordinates of the range are outside the dimensions of the sheet."
    assert.ok(this.row + this.rows - 1 <= this.sheet.getMaxRows(), "setValues: inside the sheet's rows");
    this.sheet.writes++;
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
    this.sheet.filter = { rows: this.rows, cols: this.cols };
    return this.sheet.filter;
  }
}

export class FakeSheet {
  data: unknown[][] = [];
  filter: { rows: number; cols: number } | null = null;
  frozen = 0;
  maxRows = 1000;
  maxCols = 26;
  /** setValues calls, to check that neighbouring rows go in one write. */
  writes = 0;
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
  getMaxColumns() {
    return Math.max(this.maxCols, ...this.data.map((r) => r.length));
  }
  getRange(r: number, c: number, rows = 1, cols = 1) {
    return new FakeRange(this, r, c, rows, cols);
  }
  appendRow(values: unknown[]) {
    const r = this.getLastRow() + 1;
    values.forEach((v, i) => this.set(r, i + 1, v));
  }
  deleteRow(r: number) {
    // Real Sheets: "Sorry, it is not possible to delete all non-frozen rows."
    assert.ok(this.getMaxRows() - 1 > this.frozen, "deleteRow: Sheets keeps at least one row below the frozen ones");
    const rows = this.getMaxRows();
    this.data.splice(r - 1, 1);
    this.maxRows = rows - 1;
  }
  setFrozenRows(n: number) {
    this.frozen = n;
  }
  setColumnWidth() {}
  insertRowsAfter(_after: number, n: number) {
    this.maxRows = this.getMaxRows() + n;
  }
  getFilter() {
    return this.filter;
  }
  /** Rows below the header, as plain arrays. */
  body() {
    return this.data.slice(1, this.getLastRow()).map((row) => [...row]);
  }
}

export class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>();
  timeZone: string;
  constructor(timeZone: string) {
    this.timeZone = timeZone;
  }
  getSheetByName(name: string) {
    return this.sheets.get(name) ?? null;
  }
  insertSheet(name: string) {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
  getSpreadsheetTimeZone() {
    return this.timeZone;
  }
}

export type Script = {
  doPost(e: { postData: { contents: string } }): { text: string };
  doGet(): { text: string };
  setup(): void;
  setupFeedback(): void;
  setupUsers(): void;
  clean_(value: unknown, max?: number): string;
  USER_COLUMNS: [string, string, string, number?][];
};

/**
 * A fresh copy of the script and an empty spreadsheet. `parsed` records Utilities.parseDate
 * calls; the stand-in returns the clock time as if it were UTC, so a test reads back exactly
 * the wall-clock time the script was given.
 */
export function loadScript({ secret = SECRET as string | null, lockFree = true, timeZone = "America/New_York" } = {}) {
  const ss = new FakeSpreadsheet(timeZone);
  const logs: string[] = [];
  const parsed: { value: string; tz: string; format: string }[] = [];
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
    Utilities: {
      parseDate(value: string, tz: string, format: string) {
        parsed.push({ value, tz, format });
        return new Date(`${value.replace(" ", "T")}:00Z`);
      },
    },
    Logger: { log: (m: unknown) => logs.push(String(m)) },
    console,
  };
  const script = vm.runInContext(`${SOURCE}\n;({ doPost, doGet, setup, setupFeedback, setupUsers, clean_, USER_COLUMNS });`, vm.createContext(sandbox)) as Script;
  const post = (body: unknown) => JSON.parse(script.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).text);
  return { ss, script, post, logs, parsed };
}

export const isDate = (v: unknown) => Object.prototype.toString.call(v) === "[object Date]";

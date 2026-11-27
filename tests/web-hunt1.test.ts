// Hunt 1's three fixes on the web's own requests (Mayank's exception of 2026-11-27 to "the website
// stays as it is", for these three only). Each request here is the web's: a session cookie and no
// Authorization. Each test fails on the code before the fix.
//   1. U+0000 in a profile field, meal words, a usual day, an upload's file name or an id in the
//      path threw on the database (500 after the AI call for meals and usual days); now dropped,
//      or the id is answered as missing.
//   2. The nav's initial for a name that starts with an emoji was half of one (a lone surrogate).
//   3. A meal whose AI read ran past IST midnight was stored on the next day but counted on the first.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, describe, it, mock } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
type G = { __headers?: Headers; __cookie?: string; __after: (() => unknown)[]; __aiTakes?: number; __tick?: (ms: number) => void };
const g = globalThis as unknown as G;
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async () => ({ status: 'sent' });",
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  "@/lib/ai/food": `
    export const estimateMeal = async (input) => {
      globalThis.__tick?.(globalThis.__aiTakes ?? 0);
      const item = { name: "Dal", portion: "1 bowl", grams: null, kcal: 180, protein_g: 9, carbs_g: 24, fat_g: 5, fibre_g: 6 };
      return { data: { is_food: true, reply_language: input.words.reply.id, title: "Dal", meal_guess: null, items: [item], confidence: "high", tip: null }, model: "test" };
    };
    export const estimateUsualDay = async () => ({ data: { meals: [{ name: "Day", kcal: 2200, protein_g: 70, carbs_g: 280, fat_g: 70, fibre_g: 28 }], micros: { iron_mg: 9 }, patterns: [], runs: 3 }, model: "test" });`,
  // The web's upload answers with the read's stream; this file only needs the upload stored.
  "@/lib/platform/report-stream": "export const streamAnalysis = () => new Response('stream'); export const claimRefused = () => new Response('refused', { status: 429 });",
});
const removeDatabase = tempDatabase();

const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { person, meal } = await import("./support/app-people.ts");
const { meView } = await import("../lib/platform/views/me.ts");
const R = async (file: string, method = "POST") => (await import(`../${file}`))[method] as Handler;

after(async () => {
  await removeDatabase();
});
afterEach(() => {
  mock.timers.reset();
  delete g.__tick;
  g.__aiTakes = 0;
});

/** The web's request: the person's session cookie, no Authorization. */
async function web(file: string, method: string, cookie: string, o: { json?: unknown; form?: FormData; params?: Record<string, string> } = {}) {
  g.__cookie = cookie;
  g.__headers = new Headers({ "x-forwarded-for": "10.4.0.1", ...(o.json !== undefined ? { "content-type": "application/json" } : {}) });
  const res = await (
    await R(file, method)
  )(new Request("https://www.d-human.fit/api/x", { method, headers: g.__headers, body: o.form ?? (o.json === undefined ? undefined : JSON.stringify(o.json)) }), o.params ? { params: Promise.resolve(o.params) } : undefined);
  const text = await res.text();
  return { status: res.status, text };
}
const mealForm = (text: string) => {
  const f = new FormData();
  f.append("source", "text");
  f.append("text", text);
  f.append("key", randomUUID().replace(/-/g, ""));
  return f;
};

describe("the web: U+0000 is dropped, never a 500", () => {
  it("a profile field", async () => {
    const p = await person(`web-nul-${randomUUID()}@example.com`);
    const r = await web("app/api/profile/route.ts", "POST", p.cookie, { json: { name: "Ra\u0000vi", city: "In\u0000dore" } });
    assert.equal(r.status, 200, r.text.slice(0, 160));
    const d = await db();
    const [row] = await d.select({ name: schema.profiles.name, city: schema.profiles.city }).from(schema.profiles).where(eq(schema.profiles.userId, p.id));
    assert.deepEqual(row, { name: "Ravi", city: "Indore" });
  });

  it("a meal's words: logged without it, after one AI read", async () => {
    const p = await person(`web-nul-meal-${randomUUID()}@example.com`);
    const r = await web("app/api/food/route.ts", "POST", p.cookie, { form: mealForm("dal\u0000 roti") });
    assert.equal(r.status, 200, r.text.slice(0, 160));
    const d = await db();
    const [row] = await d.select({ inputText: schema.foodLogs.inputText }).from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id));
    assert.equal(row.inputText, "dal roti");
  });

  it("a usual day", async () => {
    const p = await person(`web-nul-usual-${randomUUID()}@example.com`);
    const r = await web("app/api/food/typical/route.ts", "POST", p.cookie, { json: { description: "Poha at 8, dal\u0000 rice at 1, roti sabzi at 8" } });
    assert.equal(r.status, 200, r.text.slice(0, 160));
    const d = await db();
    const [row] = await d.select({ description: schema.dietBaselines.description }).from(schema.dietBaselines).where(eq(schema.dietBaselines.userId, p.id));
    assert.equal(row.description, "Poha at 8, dal rice at 1, roti sabzi at 8");
  });

  it("an upload's file name", async () => {
    const p = await person(`web-nul-file-${randomUUID()}@example.com`);
    const f = new FormData();
    f.append("files", new File([Buffer.from("%PDF-1.4\n%%EOF\n")], "Thyro\u0000care.pdf"));
    const r = await web("app/api/reports/route.ts", "POST", p.cookie, { form: f });
    assert.equal(r.status, 200, r.text.slice(0, 160));
    const d = await db();
    const [row] = await d.select({ fileName: schema.reports.fileName }).from(schema.reports).where(eq(schema.reports.userId, p.id));
    assert.equal(row.fileName, "Thyrocare.pdf");
  });

  it("an id in the path: missing, or already gone for a delete", async () => {
    const p = await person(`web-nul-id-${randomUUID()}@example.com`);
    const kept = await meal(p);
    for (const [file, method, want] of [
      ["app/api/stack/[id]/route.ts", "GET", 404],
      ["app/api/reports/[id]/route.ts", "GET", 404],
      ["app/api/reports/[id]/route.ts", "DELETE", 200],
      ["app/api/food/[id]/route.ts", "DELETE", 200],
    ] as const) {
      const r = await web(file, method, p.cookie, { params: { id: "\u0000" } }).catch((e: Error) => ({ status: 0, text: e.message }));
      assert.equal(r.status, want, `${method} ${file}: ${r.text.slice(0, 120)}`);
    }
    const d = await db();
    assert.equal((await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.id, kept))).length, 1, "nothing else deleted");
  });
});

describe("the web: the nav's initial is a whole character", () => {
  it("a name that starts with an emoji or another astral character gives its first grapheme; every other name is as before", () => {
    const user = { id: "u", email: "asha@example.com" };
    const initial = (name: string | null) => meView(user, { name } as Parameters<typeof meView>[1]).initial;
    assert.equal(initial("😀 Ravi"), "😀");
    assert.equal(initial("👍🏽Asha"), "👍🏽");
    assert.equal(initial("🇮🇳 Dev"), "🇮🇳");
    assert.equal(initial("𝓡avi"), "𝓡");
    // Unchanged for everyone else.
    assert.equal(initial("ravi"), "R");
    assert.equal(initial("  asha "), "A");
    assert.equal(initial("क्षमा"), "क");
    assert.equal(initial(null), "A");
    assert.equal(initial(""), "A");
  });
});

describe("the web: a meal read past IST midnight", () => {
  it("is stored on the day it was counted on", async () => {
    const p = await person(`web-midnight-${randomUUID()}@example.com`);
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-26T23:59:59+05:30").getTime() });
    g.__tick = (ms) => mock.timers.tick(ms);
    g.__aiTakes = 3000;
    const r = await web("app/api/food/route.ts", "POST", p.cookie, { form: mealForm("dal and two rotis") });
    assert.equal(r.status, 200, r.text.slice(0, 160));
    const d = await db();
    const [log] = await d.select({ id: schema.foodLogs.id, localDate: schema.foodLogs.localDate }).from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id));
    const [use] = await d.select({ localDate: schema.usage.localDate }).from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.refId, log.id)));
    assert.deepEqual([use.localDate, log.localDate], ["2026-11-26", "2026-11-26"]);
  });
});

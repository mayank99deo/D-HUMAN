// Payloads at and past their limits, and text Postgres can't store (backend test engineer, hunt 1):
// - NUL (U+0000) is valid JSON and valid multipart, but Postgres refuses it in text and jsonb, so
//   an app request carrying one in any field that's stored must be answered, never left to throw;
// - an astral character (an emoji) cut in half leaves a lone surrogate, which Swift's JSONDecoder
//   refuses, taking the whole answer with it;
// - the size limits: a 3 MB meal photo, 4 MB of report files, words at their maximum, and JSON far
//   past anything a route takes;
// - words romanized on arrival (a Hinglish or English pick that heard Devanagari).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
const g = globalThis as unknown as { __headers?: Headers; __after: (() => unknown)[] };
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: () => undefined, set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async () => ({ status: 'sent' });",
});
delete process.env.ANTHROPIC_API_KEY;
process.env.D_HUMAN_AI_MOCK = "1";
const removeDatabase = tempDatabase();

const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { person, meal } = await import("./support/app-people.ts");
const { APP_ROUTES } = await import("../lib/api/openapi.ts");
const { MEAL_ENGLISH_MAX, MEAL_WORDS_MAX } = await import("../lib/domain/speech.ts");
const { REPORT_UPLOAD } = await import("../lib/domain/uploads.ts");

after(async () => {
  await removeDatabase();
});

const route = async (file: string, method: string) => (await import(`../${file}`))[method] as Handler;
let ip = 0;
async function call(file: string, method: string, o: { token: string; json?: unknown; raw?: string; form?: FormData; params?: Record<string, string>; headers?: Record<string, string> }) {
  const headers = new Headers({ "x-forwarded-for": `10.8.${Math.floor(++ip / 250)}.${ip % 250}`, authorization: `Bearer ${o.token}`, ...o.headers });
  if (o.json !== undefined || o.raw !== undefined) headers.set("content-type", "application/json");
  g.__headers = headers;
  const res = await (
    await route(file, method)
  )(new Request("https://www.d-human.fit/api/x", { method, headers, body: o.form ?? o.raw ?? (o.json === undefined ? undefined : JSON.stringify(o.json)) }), o.params ? { params: Promise.resolve(o.params) } : undefined);
  const text = await res.text();
  return { status: res.status, text, body: text ? (JSON.parse(text) as Record<string, unknown>) : null, headers: res.headers };
}
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const LONE = /\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f][0-9a-f]{2})|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i;
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);
const jpegOf = (bytes: number) => new File([Buffer.concat([JPEG_HEAD, Buffer.alloc(bytes - JPEG_HEAD.length, 0x20)])], "meal.jpg", { type: "image/jpeg" });
const pdfOf = (bytes: number, name = "report.pdf") => new File([Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(bytes - 9, 0x20)])], name, { type: "application/pdf" });
const usualCount = async (userId: string) => {
  const d = await db();
  const rows = await d.select({ count: schema.appRateCounts.count }).from(schema.appRateCounts).where(eq(schema.appRateCounts.subject, `usual:${userId}`));
  return rows.reduce((t, r) => t + r.count, 0);
};

describe("NUL in a stored field: answered, never thrown (Postgres can't store U+0000)", () => {
  it("profile words: each field with a NUL is saved without it or refused, and the screens still read", async () => {
    const p = await person(`nul-profile-${randomUUID()}@example.com`);
    for (const field of ["name", "city", "country", "eventInMind", "medications", "currentSupplements"]) {
      const r = await call("app/api/profile/route.ts", "POST", { token: p.token, json: { [field]: `Ra\u0000vi` } });
      assert.ok(r.status === 200 || r.status === 400, `${field}: ${r.status} ${r.text.slice(0, 120)}`);
    }
    const me = await call("app/api/me/route.ts", "GET", { token: p.token });
    assert.equal(me.status, 200);
    assert.doesNotMatch(me.text, /\\u0000/);
  });

  it("a meal's words: refused or stored without it, before any AI call; nothing counted", async () => {
    const p = await person(`nul-meal-${randomUUID()}@example.com`);
    for (const [field, value] of [
      ["text", "dal\u0000 roti"],
      ["original", "दाल\u0000 रोटी"],
    ] as const) {
      const fields: Record<string, string> = { source: "text", key: randomUUID().replace(/-/g, ""), text: "dal roti", [field]: value };
      const r = await call("app/api/food/route.ts", "POST", { token: p.token, form: form(fields) });
      assert.ok(r.status === 200 || r.status === 400, `${field}: ${r.status} ${r.text.slice(0, 160)}`);
      if (r.status === 200) assert.doesNotMatch(r.text, /\\u0000/);
    }
  });

  it("a usual day's words: refused before the day's 5 saves are touched, or saved without it", async () => {
    const p = await person(`nul-usual-${randomUUID()}@example.com`);
    const r = await call("app/api/food/typical/route.ts", "POST", { token: p.token, json: { description: "Poha at 8, dal\u0000 rice at 1, roti sabzi at 8" } });
    assert.ok(r.status === 200 || r.status === 400, `${r.status} ${r.text.slice(0, 160)}`);
    if (r.status === 400) assert.equal(await usualCount(p.id), 0, "a refused save used one of the day's 5");
  });

  it("a report's file name: kept without it; the upload goes through", async () => {
    const p = await person(`nul-file-${randomUUID()}@example.com`);
    const r = await call("app/api/reports/route.ts", "POST", { token: p.token, headers: { prefer: "respond-async" }, form: form({ files: pdfOf(2000, "Thyro\u0000care.pdf"), key: randomUUID() }) });
    assert.equal(r.status, 202, r.text.slice(0, 160));
    const d = await db();
    const [row] = await d.select({ fileName: schema.reports.fileName }).from(schema.reports).where(eq(schema.reports.id, r.body!.reportId as string));
    assert.equal(row.fileName, "Thyrocare.pdf");
  });

  it("an id in the path: a NUL, or anything else that names nothing, is 404 or a no-op, never a throw", async () => {
    const p = await person(`nul-path-${randomUUID()}@example.com`);
    const routes = APP_ROUTES.filter((r) => /\{(id|publicId)\}/.test(r.path));
    for (const r of routes) {
      for (const id of ["\u0000", `${randomUUID()}\u0000`]) {
        const key = r.path.includes("{publicId}") ? "publicId" : "id";
        const body = r.method === "post" ? (r.path.endsWith("/slot") ? { meal: "lunch" } : { key: randomUUID() }) : undefined;
        const out = await call(r.file, r.method.toUpperCase(), { token: p.token, json: body, params: { [key]: id } }).catch((e: Error) => ({ status: 0, text: e.message }));
        assert.ok(out.status in r.responses && out.status !== 0 && out.status < 500, `${r.method} ${r.path} with ${JSON.stringify(id)}: ${out.status} ${out.text.slice(0, 120)}`);
      }
    }
  });
});

describe("no lone surrogate in any answer (Swift's JSONDecoder refuses the whole answer)", () => {
  it("a name that starts with an emoji or another astral character gives a whole initial", async () => {
    for (const name of ["😀 Ravi", "👍🏽Asha", "𝓡avi", "🇮🇳 Dev"]) {
      const p = await person(`astral-${randomUUID()}@example.com`, { name });
      const me = await call("app/api/me/route.ts", "GET", { token: p.token });
      assert.equal(me.status, 200);
      assert.doesNotMatch(me.text, LONE, `${name}: ${me.text.match(LONE)?.[0]}`);
      const initial = (me.body!.persona as { initial: string }).initial;
      assert.equal(initial, [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(name.trim())][0].segment.toUpperCase(), name);
    }
  });

  it("a report's file name cut at 200 characters never ends in half an emoji", async () => {
    const p = await person(`astral-file-${randomUUID()}@example.com`);
    const name = `${"a".repeat(199)}😀.pdf`;
    const r = await call("app/api/reports/route.ts", "POST", { token: p.token, headers: { prefer: "respond-async" }, form: form({ files: pdfOf(2000, name), key: randomUUID() }) });
    assert.equal(r.status, 202);
    const list = await call("app/api/reports/route.ts", "GET", { token: p.token });
    assert.equal(list.status, 200);
    assert.doesNotMatch(list.text, LONE);
  });
});

describe("sizes at and past each limit", () => {
  it("a meal photo of exactly 3 MB is read; one byte more is 413 too_large; nothing counted for it", async () => {
    const p = await person(`photo-${randomUUID()}@example.com`);
    const at = await call("app/api/food/route.ts", "POST", { token: p.token, form: form({ source: "photo", key: randomUUID(), photo: jpegOf(3 * 1024 * 1024) }) });
    assert.equal(at.status, 200, at.text.slice(0, 160));
    const over = await call("app/api/food/route.ts", "POST", { token: p.token, form: form({ source: "photo", key: randomUUID(), photo: jpegOf(3 * 1024 * 1024 + 1) }) });
    assert.equal(over.status, 413);
    assert.equal(over.body!.error, "too_large");
  });

  it("report files of exactly 4 MB in all are read; one byte more is 413; seven photos 400; a PDF with a photo 400", async () => {
    const p = await person(`upload-${randomUUID()}@example.com`);
    const send = (files: File[]) => {
      const f = form({ key: randomUUID() });
      for (const x of files) f.append("files", x);
      return call("app/api/reports/route.ts", "POST", { token: p.token, headers: { prefer: "respond-async" }, form: f });
    };
    const over = await send([pdfOf(REPORT_UPLOAD.maxTotalBytes + 1)]);
    assert.equal(over.status, 413);
    const seven = await send(Array.from({ length: 7 }, () => jpegOf(1000)));
    assert.equal(seven.status, 400);
    assert.equal(seven.body!.error, "too_many_files");
    const mixed = await send([pdfOf(1000), jpegOf(1000)]);
    assert.equal(mixed.body!.error, "one_pdf");
    const at = await send([pdfOf(REPORT_UPLOAD.maxTotalBytes)]);
    assert.equal(at.status, 202, at.text.slice(0, 160));
  });

  it("meal words: own words to 1000, a translation to 2000 beside them; past either 400 invalid", async () => {
    const p = await person(`words-${randomUUID()}@example.com`);
    const send = (fields: Record<string, string>) => call("app/api/food/route.ts", "POST", { token: p.token, form: form({ source: "text", key: randomUUID(), ...fields }) });
    assert.equal((await send({ text: "d".repeat(MEAL_WORDS_MAX) })).status, 200);
    assert.equal((await send({ text: "d".repeat(MEAL_WORDS_MAX + 1) })).status, 400);
    assert.equal((await send({ text: "d".repeat(MEAL_ENGLISH_MAX), original: "दाल" })).status, 200);
    assert.equal((await send({ text: "d".repeat(MEAL_ENGLISH_MAX + 1), original: "दाल" })).status, 400);
  });

  it("the contract's own limits for meal words are the server's", async () => {
    const { MealForm } = await import("../lib/api/schemas.ts");
    const text = MealForm.shape.text.unwrap();
    assert.ok(text.safeParse("d".repeat(MEAL_ENGLISH_MAX)).success, "the contract refuses words the server takes");
    assert.ok(!text.safeParse("d".repeat(MEAL_ENGLISH_MAX + 1)).success, `the contract allows words the server refuses (over ${MEAL_ENGLISH_MAX})`);
  });

  it("JSON far past any route's size, or nested deep, is a refusal, not a crash", async () => {
    const p = await person(`json-${randomUUID()}@example.com`);
    const deep = `${'{"a":'.repeat(100_000)}{"name":"x"}${"}".repeat(100_000)}`;
    for (const raw of [JSON.stringify({ name: "x".repeat(6 * 1024 * 1024) }), deep, JSON.stringify(Array.from({ length: 200_000 }, (_, i) => i)), `{"name":"${"\\u0000".repeat(100_000)}"}`]) {
      const r = await call("app/api/profile/route.ts", "POST", { token: p.token, raw });
      assert.ok(r.status === 400 || r.status === 200, `${raw.slice(0, 30)}: ${r.status}`);
    }
    const t = await call("app/api/food/typical/route.ts", "POST", { token: p.token, json: { description: "x".repeat(6 * 1024 * 1024) } });
    assert.equal(t.status, 400);
    assert.equal(await usualCount(p.id), 0);
  });
});

describe("romanized on arrival: Unicode edge cases", () => {
  it("Devanagari with nukta, joiners, signs, digits and emoji: Latin letters out, the raw words kept, no lone surrogate", async () => {
    const p = await person(`roman-${randomUUID()}@example.com`);
    const d = await db();
    for (const words of ["दो रोटी और दाल 🍛", "क़ीमा पराठा", "क़ीमा", "दाल‍मखनी", "२०० ग्राम चावल", "चाय।", `${"दो रोटी और दाल ".repeat(80).slice(0, MEAL_WORDS_MAX)}`]) {
      const key = randomUUID();
      const r = await call("app/api/food/route.ts", "POST", { token: p.token, form: form({ source: "voice", spoken: "hinglish", key, text: words }) });
      if (r.status === 402) break; // the day's 5
      assert.equal(r.status, 200, `${words.slice(0, 20)}: ${r.text.slice(0, 160)}`);
      assert.doesNotMatch(r.text, LONE);
      const [row] = await d.select({ inputText: schema.foodLogs.inputText, inputRaw: schema.foodLogs.inputRaw }).from(schema.foodLogs).where(and(eq(schema.foodLogs.userId, p.id))).orderBy(schema.foodLogs.createdAt);
      assert.ok(row);
    }
  });

  it("words that romanize to nothing (a lone sign) are refused as empty, with no AI call and nothing counted", async () => {
    const p = await person(`roman-empty-${randomUUID()}@example.com`);
    for (const words of ["ं", "ॐ", "़़"]) {
      const r = await call("app/api/food/route.ts", "POST", { token: p.token, form: form({ source: "voice", spoken: "hinglish", key: randomUUID(), text: words }) });
      assert.equal(r.status, 400, `${JSON.stringify(words)}: ${r.status} ${r.text.slice(0, 120)}`);
      assert.equal(r.body!.error, "empty");
    }
    const d = await db();
    assert.equal((await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id))).length, 0);
    assert.equal((await d.select().from(schema.usage).where(eq(schema.usage.userId, p.id))).length, 0);
    await meal(p); // the person can still log
  });
});

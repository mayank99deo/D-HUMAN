// The meal route in any language, against a real embedded database with Claude
// stubbed: the reply language is decided on the server (a spoken language only
// counts for voice, an unknown one is ignored), the browser's translation is what
// gets read, and the person's own words are what gets stored. Mock mode answers in
// the reply language too.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Captured = { words: { said: string; english: string | null; saidIn: { id: string }; reply: { id: string } }; voice: boolean };
type TestGlobals = { __testUser?: { id: string; email: string } | null; __aiMode: "live" | "mock"; __meals: Captured[]; __claim?: string };
const g = globalThis as unknown as TestGlobals;
g.__aiMode = "live";
g.__meals = [];

allowAppImports({
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => globalThis.__aiMode;`,
  "@/lib/ai/food": `
    export const estimateMeal = async (input) => {
      globalThis.__meals.push(input);
      const item = { name: "Idli", portion: "2", grams: null, kcal: 120, protein_g: 4, carbs_g: 24, fat_g: 1, fibre_g: 2 };
      const micros = { iron_mg: 1, calcium_mg: 10, magnesium_mg: 10, zinc_mg: 1, b12_ug: 0, folate_ug: 10, vitamin_c_mg: 0, vitamin_d_iu: 0 };
      const reply_language = globalThis.__claim ?? input.words.reply.id;
      return { data: { is_food: true, reply_language, title: "reply:" + input.words.reply.id, meal_guess: null, items: [item], micros, confidence: "high", tip: null }, model: "test" };
    };
    export const estimateTypicalDay = () => { throw new Error("AI in a test"); };`,
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
  "@/lib/billing/razorpay": `export const paymentsOn = () => false; export const keyMode = () => "test";`,
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { POST: foodRoute } = await import("../app/api/food/route.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

let n = 0;
async function personSpeaking(language: "en" | "hi" | "hinglish") {
  const d = await db();
  const id = `lang-user-${++n}`;
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  await d.insert(schema.profiles).values({ userId: id, language, onboardedAt: new Date() });
  return { id, email: `${id}@example.com` };
}

async function logMeal(language: "en" | "hi" | "hinglish", fields: Record<string, string>) {
  const user = await personSpeaking(language);
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  g.__testUser = user;
  const before = g.__meals.length;
  const res = await foodRoute(new Request("http://localhost/api/food", { method: "POST", body: form }));
  g.__testUser = null;
  const body = (await res.json()) as { log?: { title: string; inputText: string | null; micros: { lang?: string } } };
  const d = await db();
  const [row] = await d.select().from(schema.foodLogs).where(eq(schema.foodLogs.userId, user.id));
  return { status: res.status, body, row, sent: g.__meals.length > before ? g.__meals[g.__meals.length - 1] : null };
}

describe("meal languages on the server", () => {
  it("reads the browser's translation, answers in the language spoken, and stores their own words", async () => {
    const tamil = "இரண்டு இட்லி சாம்பார்";
    const r = await logMeal("en", { source: "voice", spoken: "ta", text: "Two idlis with sambar", original: tamil });
    assert.equal(r.status, 200);
    assert.equal(r.sent?.words.reply.id, "ta");
    assert.equal(r.sent?.words.english, "Two idlis with sambar");
    assert.equal(r.sent?.words.said, tamil);
    assert.equal(r.sent?.voice, true);
    assert.equal(r.row.inputText, tamil);
    assert.equal(r.body.log?.title, "reply:ta");
  });

  it("ignores a language it doesn't know and goes by the script", async () => {
    const r = await logMeal("en", { source: "voice", spoken: "klingon", text: "दो रोटी और दाल" });
    assert.equal(r.status, 200);
    assert.equal(r.sent?.words.reply.id, "hi");
  });

  it("only counts the spoken language for meals logged by voice", async () => {
    const r = await logMeal("en", { source: "text", spoken: "ta", text: "দুটো রুটি আর ডাল" });
    assert.equal(r.status, 200);
    assert.equal(r.sent?.words.reply.id, "bn");
    assert.equal(r.sent?.voice, false);
  });

  it("expects a Latin-letter reply for Latin script", async () => {
    assert.equal((await logMeal("hi", { source: "text", text: "2 roti, dal" })).sent?.words.reply.id, "hinglish");
    assert.equal((await logMeal("hinglish", { source: "text", text: "2 roti, dal" })).sent?.words.reply.id, "hinglish");
    assert.equal((await logMeal("en", { source: "text", text: "2 rotis and dal" })).sent?.words.reply.id, "en");
  });

  it("stores typed words as typed, with no translation", async () => {
    const r = await logMeal("en", { source: "text", text: "  2 rotis and dal  " });
    assert.equal(r.row.inputText, "2 rotis and dal");
    assert.equal(r.sent?.words.english, null);
  });

  it("allows a long translation but not long words of their own", async () => {
    const long = "rice and dal ".repeat(100).trim(); // 1,299 characters
    const own = await logMeal("en", { source: "text", text: long });
    assert.equal(own.status, 400);
    assert.equal(own.sent, null);
    const translated = await logMeal("en", { source: "voice", spoken: "hi", text: long, original: "चावल और दाल" });
    assert.equal(translated.status, 200);
    assert.equal(translated.row.inputText, "चावल और दाल");
  });

  it("keeps the language the model wrote in when it fits the words, else the expected one", async () => {
    try {
      g.__claim = "hinglish";
      const hinglish = await logMeal("en", { source: "voice", spoken: "en", text: "do roti aur dal khayi" });
      assert.equal(hinglish.sent?.words.reply.id, "en");
      assert.equal(hinglish.body.log?.micros.lang, "hinglish");
      g.__claim = "en";
      const tamil = await logMeal("en", { source: "voice", spoken: "ta", text: "இரண்டு இட்லி" });
      assert.equal(tamil.body.log?.micros.lang, "ta", "Tamil words keep a Tamil reply");
      g.__claim = "klingon";
      assert.equal((await logMeal("en", { source: "text", text: "2 rotis and dal" })).body.log?.micros.lang, "en");
    } finally {
      g.__claim = undefined;
    }
  });

  it("answers in the reply language in mock mode", async () => {
    g.__aiMode = "mock";
    try {
      const tamil = await logMeal("en", { source: "voice", spoken: "ta", text: "இரண்டு இட்லி" });
      assert.equal(tamil.status, 200);
      assert.equal(tamil.body.log?.title, "உங்கள் உணவு");
      const hindi = await logMeal("en", { source: "voice", spoken: "hi", text: "Rajma and rice", original: "राजमा चावल" });
      assert.equal(hindi.body.log?.title, "आपका खाना: Rajma chawal");
      assert.equal(hindi.row.inputText, "राजमा चावल");
      const english = await logMeal("en", { source: "text", text: "2 rotis and dal" });
      assert.equal(english.body.log?.title, "Dal, roti and sabzi");
      // English picked, Hindi spoken: the browser writes it in Latin letters, and the reply follows.
      const mixed = await logMeal("en", { source: "voice", spoken: "en", text: "do roti aur dal khayi" });
      assert.equal(mixed.body.log?.title, "Aapka khana: Dal, roti and sabzi");
      assert.equal(mixed.body.log?.micros.lang, "hinglish");
    } finally {
      g.__aiMode = "live";
    }
  });
});

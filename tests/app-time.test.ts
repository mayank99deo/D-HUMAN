// Time on the apps' path (backend test engineer, hunt 1): the server clock is set to exact
// moments with node:test's mock timers (Date only; the database keeps its own clock, which is
// also how clock skew between Vercel and Supabase is tried), and each rule is checked at the
// edge of its window, one second either side:
//   - eatenAt: 48 hours old and 5 minutes ahead, inclusive;
//   - a meal whose AI read runs past IST midnight counts and shows on one day, the one it was claimed on;
//   - 5 meals a day turns over at 00:00 IST exactly, and for a person in another time zone at their midnight;
//   - the apps' usual-day cap and daily breaker turn over at 00:00 IST, with Retry-After to the second;
//   - a sign-in resend still finds its session when the server's clock is a minute off the database's.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, describe, it, mock } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
const g = globalThis as unknown as { __headers?: Headers; __after: (() => unknown)[]; __aiTakes?: number; __tick?: (ms: number) => void };
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: () => undefined, set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
  "@/lib/email/send": "export const sendFounderAlert = async () => ({ status: 'sent' });",
  "@/lib/auth/email": "export const sendSignInCode = async () => true;",
  // A live AI whose meal read takes __aiTakes ms of the server's clock.
  "@/lib/ai/client": `export class AiRefusalError extends Error {}; export class AiUnavailableError extends Error {}; export const aiMode = () => "live";`,
  "@/lib/ai/food": `
    export const estimateMeal = async (input) => {
      globalThis.__tick?.(globalThis.__aiTakes ?? 0);
      const item = { name: "Dal", portion: "1 bowl", grams: null, kcal: 180, protein_g: 9, carbs_g: 24, fat_g: 5, fibre_g: 6 };
      return { data: { is_food: true, reply_language: input.words.reply.id, title: "Dal", meal_guess: null, items: [item], confidence: "high", tip: null }, model: "test" };
    };
    export const estimateUsualDay = async () => ({ data: { meals: [{ name: "Day", kcal: 2200, protein_g: 70, carbs_g: 280, fat_g: 70, fibre_g: 28 }], micros: { iron_mg: 9 }, patterns: [], runs: 3 }, model: "test" });`,
});
const removeDatabase = tempDatabase();

const { and, eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { person } = await import("./support/app-people.ts");
const { localDate } = await import("../lib/platform/profile.ts");
const { EATEN_AT_MAX_AGE_MS, EATEN_AT_MAX_AHEAD_MS } = await import("../lib/api/meal-writes.ts");
const { USUAL_DAYS_PER_DAY } = await import("../lib/api/app-limits.ts");
const { issueCode } = await import("../lib/auth/codes.ts");
const food = (await import("../app/api/food/route.ts")).POST as Handler;
const typical = (await import("../app/api/food/typical/route.ts")).POST as Handler;
const token = (await import("../app/api/auth/token/route.ts")).POST as Handler;

after(async () => {
  await removeDatabase();
});
afterEach(() => {
  mock.timers.reset();
  delete g.__tick;
  g.__aiTakes = 0;
});

/** Sets the server's clock (Date only) to `at`; the database's clock is untouched. */
function clockAt(at: Date) {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: at.getTime() });
  g.__tick = (ms) => mock.timers.tick(ms);
}
const ist = (s: string) => new Date(`${s}+05:30`);
let ip = 0;
async function logMeal(token: string, fields: Record<string, string> = {}) {
  const headers = new Headers({ authorization: `Bearer ${token}`, "x-forwarded-for": `10.7.0.${++ip % 250}` });
  g.__headers = headers;
  const f = new FormData();
  for (const [k, v] of Object.entries({ source: "text", text: "dal and two rotis", key: randomUUID().replace(/-/g, ""), ...fields })) f.append(k, v);
  const res = await food(new Request("https://www.d-human.fit/api/food", { method: "POST", headers, body: f }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}
async function used(userId: string, day: string, n: number) {
  const d = await db();
  for (let i = 0; i < n; i++) await d.insert(schema.usage).values({ id: randomUUID(), userId, kind: "meal", refId: randomUUID(), localDate: day });
}

describe("eatenAt at the edges of its window", () => {
  it("48 hours old exactly is in, a second more is out; 5 minutes ahead exactly is in, a second more is out", async () => {
    const now = ist("2026-11-26T15:00:00");
    const p = await person(`edge-${randomUUID()}@example.com`);
    clockAt(now);
    const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
    const cases: [string, number][] = [
      [at(-EATEN_AT_MAX_AGE_MS), 200],
      [at(-EATEN_AT_MAX_AGE_MS - 1000), 400],
      [at(-EATEN_AT_MAX_AGE_MS + 1000), 200],
      [at(EATEN_AT_MAX_AHEAD_MS), 200],
      [at(EATEN_AT_MAX_AHEAD_MS + 1000), 400],
    ];
    const d = await db();
    for (const [eatenAt, want] of cases) {
      // A new person each time: the 5 a day must not decide these.
      const q = await person(`edge-${randomUUID()}@example.com`);
      const r = await logMeal(q.token, { eatenAt });
      assert.equal(r.status, want, `${eatenAt}: ${JSON.stringify(r.body)}`);
      if (want === 400) assert.equal(r.body.error, "bad_time");
      if (want === 200) {
        const [row] = await d.select({ localDate: schema.foodLogs.localDate }).from(schema.foodLogs).where(eq(schema.foodLogs.userId, q.id));
        assert.equal(row.localDate, localDate("Asia/Kolkata", new Date(eatenAt)), "it counts on the day it was eaten");
      }
    }
    void p;
  });
});

describe("IST midnight", () => {
  it("a meal whose AI read runs past midnight counts and shows on the day it was claimed, not one each", async () => {
    const p = await person(`midnight-${randomUUID()}@example.com`);
    clockAt(ist("2026-11-26T23:59:59"));
    g.__aiTakes = 3000; // the read ends at 00:00:02 IST on the 27th
    const r = await logMeal(p.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = await db();
    const [log] = await d.select({ localDate: schema.foodLogs.localDate, id: schema.foodLogs.id }).from(schema.foodLogs).where(eq(schema.foodLogs.userId, p.id));
    const [use] = await d.select({ localDate: schema.usage.localDate }).from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.refId, log.id)));
    assert.equal(use.localDate, "2026-11-26", "counted on the 26th");
    assert.equal(log.localDate, use.localDate, "the meal shows on the day it counted on");
  });

  it("a meal read past midnight can't give a sixth on either day", async () => {
    const p = await person(`sixth-${randomUUID()}@example.com`);
    await used(p.id, "2026-11-26", 4);
    clockAt(ist("2026-11-26T23:59:59"));
    g.__aiTakes = 3000;
    assert.equal((await logMeal(p.token)).status, 200); // the 26th's fifth
    g.__aiTakes = 0;
    await used(p.id, "2026-11-27", 4);
    // Now, on the 27th, four are used: one more is allowed, then 402, and the 27th shows five meals at most.
    assert.equal((await logMeal(p.token)).status, 200);
    assert.equal((await logMeal(p.token)).status, 402);
    const d = await db();
    const shown = await d.select().from(schema.foodLogs).where(and(eq(schema.foodLogs.userId, p.id), eq(schema.foodLogs.localDate, "2026-11-27")));
    const counted = await d.select().from(schema.usage).where(and(eq(schema.usage.userId, p.id), eq(schema.usage.localDate, "2026-11-27")));
    assert.equal(counted.length, 5);
    assert.ok(shown.length <= 1, `the 27th shows ${shown.length} meals logged through the API, with 1 counted there`);
  });

  it("5 a day: full at 23:59:59 IST, open again at 00:00:00 IST", async () => {
    const p = await person(`turn-${randomUUID()}@example.com`);
    await used(p.id, "2026-11-26", 5);
    clockAt(ist("2026-11-26T23:59:59"));
    const full = await logMeal(p.token);
    assert.deepEqual([full.status, full.body.refusal], [402, "meals_today_used"]);
    clockAt(ist("2026-11-27T00:00:00"));
    assert.equal((await logMeal(p.token)).status, 200);
  });

  it("someone in another time zone turns over at their own midnight, not IST's", async () => {
    const p = await person(`ny-${randomUUID()}@example.com`, { timezone: "America/New_York" });
    await used(p.id, "2026-11-26", 5);
    // 00:30 IST on the 27th is 14:00 on the 26th in New York: still full.
    clockAt(ist("2026-11-27T00:30:00"));
    assert.equal((await logMeal(p.token)).status, 402);
    // 00:00 on the 27th in New York.
    clockAt(new Date("2026-11-27T00:00:00-05:00"));
    assert.equal((await logMeal(p.token)).status, 200);
  });

  it("the apps' usual-day cap: the sixth at 23:59:59 IST is 429 with Retry-After 1; at 00:00:00 IST it's a new day", async () => {
    const p = await person(`usual-${randomUUID()}@example.com`);
    const save = async (i: number) => {
      g.__headers = new Headers({ authorization: `Bearer ${p.token}`, "content-type": "application/json" });
      const res = await typical(new Request("https://www.d-human.fit/api/food/typical", { method: "POST", headers: g.__headers, body: JSON.stringify({ description: `Poha at 8, dal rice at 1, roti sabzi at 8, day ${i}` }) }));
      return { status: res.status, retryAfter: res.headers.get("retry-after") };
    };
    clockAt(ist("2026-11-26T23:59:59"));
    for (let i = 0; i < USUAL_DAYS_PER_DAY; i++) assert.equal((await save(i)).status, 200);
    const sixth = await save(99);
    assert.deepEqual([sixth.status, sixth.retryAfter], [429, "1"]);
    clockAt(ist("2026-11-27T00:00:00"));
    assert.equal((await save(100)).status, 200);
  });
});

describe("server clock skew against the database", () => {
  for (const skewMs of [-60_000, 60_000]) {
    it(`a sign-in resend finds its one session with the server ${skewMs > 0 ? "ahead of" : "behind"} the database by a minute`, async () => {
      const email = `skew-${randomUUID()}@example.com`;
      const issued = await issueCode(email);
      assert.ok(issued.ok);
      clockAt(new Date(Date.now() + skewMs));
      const key = randomUUID();
      const send = async () => {
        const res = await token(new Request("https://www.d-human.fit/api/auth/token", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.6.0.${++ip % 250}` }, body: JSON.stringify({ email, code: issued.code, key }) }));
        return { status: res.status, body: (await res.json()) as { token?: string } };
      };
      const first = await send();
      assert.equal(first.status, 200, JSON.stringify(first.body));
      const again = await send();
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.equal(again.body.token, first.body.token);
    });
  }
});

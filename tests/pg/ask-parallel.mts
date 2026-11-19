// Ask's ledger under real parallel load, on a real Postgres (opt-in; not part of npm test).
// PGlite runs one query at a time, so only a real server can prove the row locks. This drives
// the app's own functions (lib/platform/ask.ts) through the app's own pool (lib/db, 5
// connections), the data spec's six checks:
//   1. one person, 50 questions at once: exactly one in flight;
//   2. one person, 20 workers racing: exactly 5 answered;
//   3. 40 people racing a breaker of 60: exactly 60 calls;
//   4. one client key sent 20 times at once: one question;
//   5. 30 workers failing every call: calls stop at exactly 10, questions never below 0;
//   6. mixed claims across 40 people with report deletes landing mid-answer: no deadlock,
//      and every count equals that person's counted, answered questions;
//   7. the loader and the thread read the same through postgres.js as through PGlite.
//
// Run it against a database you can write to (it migrates it, then removes only its own rows):
//   TEST_DATABASE_URL=postgres://user:pass@host:5432/db node tests/pg/ask-parallel.mts
// Without TEST_DATABASE_URL it says so and exits 0.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowAppImports } from "../support/app.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log("skipped: set TEST_DATABASE_URL to a Postgres you can write to");
  process.exit(0);
}
allowAppImports({ "@/lib/email/send": `export const sendFounderAlert = async () => ({ status: "sent" });` });
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { default: postgres } = await import("postgres");
const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
await migrate(drizzle(admin), { migrationsFolder: path.join(root, "drizzle") });
console.log(`server: ${(await admin`select version()`)[0].version.split(" ").slice(0, 2).join(" ")}`);

const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../../lib/db/index.ts");
const ask = await import("../../lib/platform/ask.ts");
type Claim = Awaited<ReturnType<typeof ask.claimAsk>>;

const run = crypto.randomUUID().slice(0, 8);
const people = Array.from({ length: 40 }, (_, i) => `ask-par-${run}-${i}`);
// Days far from real ones, unique to this run, so everyone's totals don't collide.
const year = 2100 + Math.floor(Math.random() * 800);
const day = (n: number) => `${year}-01-${String(n).padStart(2, "0")}`;
const d = await db();
await d.insert(schema.users).values(people.map((id) => ({ id, email: `${id}@example.test` })));

const usage = { model: "test", inputTokens: 5000, outputTokens: 300, costMicros: 650, ms: 1 };
const reply = (kind: "answer" | "urgent") =>
  kind === "urgent"
    ? ({ kind, answer: null, notice: { level: "urgent", label: "Get advice today", parts: ["symptom"], lines: ["x"], markers: [], calls: [] }, links: [], lang: "en", floorRaised: true, filter: null } as const)
    : ({ kind, answer: "a", notice: null, links: [], lang: "en", floorRaised: false, filter: null } as const);
const claim = (user: string, onDay: string, o: { key?: string; max?: number; reportId?: string | null } = {}) =>
  ask.claimAsk({ userId: user, clientKey: o.key ?? crypto.randomUUID(), day: onDay, question: "q", reportId: o.reportId ?? null, max: o.max ?? 1e6 });
const finish = (c: Claim & { ok: true }, user: string, kind: "answer" | "urgent" = "answer") =>
  ask.completeAsk({ turnId: c.turnId, userId: user, reply: reply(kind) as never, usage, counted: kind === "answer" });
const tally = (rs: Claim[]) => rs.reduce<Record<string, number>>((m, r) => ((m[r.ok ? "ok" : r.reason] = (m[r.ok ? "ok" : r.reason] ?? 0) + 1), m), {});
const counts = (user: string, onDay: string) => ask.askCounters(user, onDay);

try {
  // 1.
  let rs = await Promise.all(Array.from({ length: 50 }, () => claim(people[0], day(1))));
  assert.deepEqual(tally(rs), { ok: 1, busy: 49 });
  assert.deepEqual(await counts(people[0], day(1)), { used: 1, attempts: 1 });
  console.log("ok  1. one person, 50 parallel questions: 1 in flight, 49 busy, counts show 1");

  // 2.
  let answered2 = 0;
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      for (;;) {
        const c = await claim(people[1], day(2));
        if (!c.ok && c.reason === "limit") return;
        if (c.ok) {
          answered2++;
          await finish(c, people[1]);
        }
      }
    }),
  );
  assert.equal(answered2, 5);
  assert.deepEqual(await counts(people[1], day(2)), { used: 5, attempts: 5 });
  console.log("ok  2. one person, 20 workers racing until refused: exactly 5 answered");

  // 3.
  const out3: Claim[] = [];
  await Promise.all(
    people.flatMap((u) =>
      Array.from({ length: 4 }, async () => {
        for (;;) {
          const c = await claim(u, day(3), { max: 60 });
          out3.push(c);
          if (!c.ok && (c.reason === "limit" || c.reason === "paused")) return;
          if (c.ok) await finish(c, u);
        }
      }),
    ),
  );
  const [t3] = await admin`select attempts, answered from ask_totals where day = ${day(3)}`;
  const [s3] = await admin`select sum(used)::int as used, sum(attempts)::int as tries from ask_days where day = ${day(3)}`;
  assert.deepEqual([t3.attempts, t3.answered, s3.used, s3.tries], [60, 60, 60, 60]);
  console.log(`ok  3. 40 people racing a breaker of 60: ${JSON.stringify(tally(out3))}; exactly 60 calls, answers and counted questions`);

  // 4.
  const key = crypto.randomUUID();
  rs = await Promise.all(Array.from({ length: 20 }, () => claim(people[2], day(4), { key })));
  const t4 = tally(rs);
  assert.equal(t4.ok, 1);
  assert.equal((t4.busy ?? 0) + (t4.duplicate ?? 0), 19);
  assert.deepEqual(await counts(people[2], day(4)), { used: 1, attempts: 1 });
  console.log(`ok  4. one client key sent 20 times at once: ${JSON.stringify(t4)}; one question counted`);

  // 5.
  await Promise.all(
    Array.from({ length: 30 }, async () => {
      for (;;) {
        const c = await claim(people[3], day(5));
        if (!c.ok && c.reason === "too_many_tries") return;
        if (c.ok) await ask.releaseAsk(c.turnId, people[3]);
      }
    }),
  );
  assert.deepEqual(await counts(people[3], day(5)), { used: 0, attempts: 10 });
  console.log("ok  5. 30 workers asking and failing: used 0, calls stop at exactly 10");

  // 6.
  const out6: Claim[] = [];
  let stop = false;
  const deleter = (async () => {
    while (!stop) await d.transaction((tx) => ask.blankAskAnswers(tx, people[Math.floor(Math.random() * people.length)]));
  })();
  await Promise.all(
    people.flatMap((u) =>
      Array.from({ length: 3 }, async () => {
        for (let i = 0; i < 12; i++) {
          const c = await claim(u, day(6), { reportId: Math.random() < 0.5 ? "report" : null });
          out6.push(c);
          if (!c.ok && (c.reason === "limit" || c.reason === "too_many_tries")) return;
          if (!c.ok) continue;
          const roll = Math.random();
          if (roll < 0.25) await ask.releaseAsk(c.turnId, u);
          else if (!(await finish(c, u, roll < 0.4 ? "urgent" : "answer"))) await ask.releaseAsk(c.turnId, u); // blanked mid-answer
        }
      }),
    ),
  );
  stop = true;
  await deleter;
  const bad = await admin`
    select d.user_id from ask_days d where d.day = ${day(6)} and d.used <> (
      select count(*)::int from ask_turns t where t.user_id = d.user_id and t.day = d.day and t.status = 'answered' and t.counted)`;
  assert.equal(bad.length, 0, `counts that don't match: ${bad.length}`);
  assert.equal((await admin`select count(*)::int as n from ask_turns where day = ${day(6)} and status = 'pending'`)[0].n, 0);
  const [t6] = await admin`select attempts from ask_totals where day = ${day(6)}`;
  const [s6] = await admin`select sum(attempts)::int as tries from ask_days where day = ${day(6)}`;
  assert.equal(t6.attempts, s6.tries);
  console.log(`ok  6. ${out6.length} mixed claims across 40 people with report deletes mid-answer, no deadlock: ${JSON.stringify(tally(out6))}; every count matches its answered questions`);

  // 7. The loader and the thread through postgres.js (PGlite returns rows differently).
  const me = people[39];
  await d.insert(schema.profiles).values({ userId: me, birthYear: 1990, sex: "male", heightCm: 175, weightKg: 70, consentAt: new Date(), onboardedAt: new Date(), askConsentAt: new Date() });
  const [profile] = await d.select().from(schema.profiles).where(eq(schema.profiles.userId, me));
  const older = crypto.randomUUID();
  const newer = crypto.randomUUID();
  await d.insert(schema.reports).values([
    { id: older, userId: me, status: "ready", collectedOn: "2026-11-01", createdAt: new Date(Date.now() - 86_400_000), analyzedAt: new Date() },
    { id: newer, userId: me, status: "ready", collectedOn: "2025-06-01", createdAt: new Date(), analyzedAt: new Date() },
  ]);
  await d.insert(schema.analyses).values({ reportId: older, userId: me, read: { verdict: { level: "doctor_first" } } });
  await d.insert(schema.markers).values([
    { id: crypto.randomUUID(), reportId: older, userId: me, key: "hemoglobin", name: "Hb", value: 6, status: "low", flag: "urgent", position: 1 },
    { id: crypto.randomUUID(), reportId: older, userId: me, key: "tsh", name: "TSH", value: 2, status: "in_range", position: 0 },
  ]);
  const today = ask.istDay();
  const c7 = await claim(me, today);
  assert.ok(c7.ok && c7.at instanceof Date && Math.abs(c7.at.getTime() - Date.now()) < 60_000, "the claim's time reads back as a Date");
  assert.ok(await finish(c7, me));
  const load = await ask.loadAsk(me, profile, { now: new Date(), plan: true });
  assert.equal(load.data.report?.id, older, "newest by collection date");
  assert.equal(load.data.report?.verdictLevel, "doctor_first");
  assert.deepEqual(load.data.report?.markers.map((m) => m.key), ["tsh", "hemoglobin"], "in the report's order");
  assert.deepEqual(load.counters, { used: 1, attempts: 1 });
  assert.equal(typeof load.mealsEver, "boolean");
  assert.ok(load.plan, "the plan loads");
  const thread = ask.askThread(load, profile, "ready");
  assert.equal(thread.turns.length, 1);
  assert.deepEqual(thread.pinned.urgent, ["Haemoglobin"]);
  assert.equal(thread.left, 4);
  console.log("ok  7. the loader and the thread read the same through postgres.js: newest report by collection date, markers in order, counts, plan");
} finally {
  // Only this run's rows: the people (their turns and counts cascade) and its days' totals.
  await admin`delete from users where id like ${`ask-par-${run}-%`}`;
  await admin`delete from ask_totals where day between ${day(1)} and ${day(6)}`;
  await admin.end();
  await (d as unknown as { $client: { end(): Promise<void> } }).$client.end();
}

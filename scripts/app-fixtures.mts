// Writes the apps' demo responses: every GET the apps use, for each demo person, from the real
// route handlers on a fresh embedded database in mock mode, so the mobile repo can vendor them as
// shared/fixtures/api/ (its docs/APP-STRUCTURE.md §4, "Stubs"). Demo people only: everyone here is
// made up by this script, and nothing is read from any other database.
//   node scripts/app-fixtures.mts [--out docs/api/fixtures]
// Each answer is checked against its schema in lib/api/openapi.ts first; the script fails if one
// doesn't parse. Files: <out>/<scenario>/<route>.json as { status, etag, body }, plus
// <out>/errors/*.json (refusals the app handles) and <out>/SOURCE (the commit they came from).
// Dates in them are the day the script ran.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { allowAppImports, tempDatabase } from "../tests/support/app.ts";
import { call, meal, person, type Handler, type Person } from "../tests/support/app-people.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values: args } = parseArgs({ options: { out: { type: "string" } } });
const out = path.resolve(args.out ?? path.join(ROOT, "docs/api/fixtures"));

const g = globalThis as unknown as { __after: (() => unknown)[] };
g.__after = [];
allowAppImports({
  "next/headers": `
    export const headers = async () => globalThis.__headers ?? new Headers();
    export const cookies = async () => ({ get: (name) => (globalThis.__cookie ? { name, value: globalThis.__cookie } : undefined), set: () => {}, delete: () => {} });`,
  "next/server": "export const after = (fn) => { globalThis.__after.push(fn); }; export const connection = async () => {};",
});
for (const k of ["ANTHROPIC_API_KEY", "RESEND_API_KEY", "VERCEL", "BLOG_OWNER_EMAILS", "ASK_OPEN", "RAZORPAY_KEY_ID", "APP_SWITCHES_OFF"]) delete process.env[k];
process.env.D_HUMAN_AI_MOCK = "1";
const removeDatabase = tempDatabase();
const quiet = console.info;
console.info = () => {};

const { db, schema } = await import("../lib/db/index.ts");
const { getProfile, personaFor } = await import("../lib/platform/profile.ts");
const { APP_ROUTES } = await import("../lib/api/openapi.ts");

const handler = async (p: string) => {
  const r = APP_ROUTES.find((x) => x.method === "get" && x.path === p)!;
  return { route: r, fn: (await import(`../${r.file}`)).GET as Handler };
};

// ── The demo people ──────────────────────────────────────────────────────────

async function readReport(p: Person, o: { flag?: "doctor" | "urgent"; printed?: string } = {}) {
  const d = await db();
  const persona = personaFor((await getProfile(p.id))!);
  const keys = persona.priorities.slice(0, 5);
  const reportId = randomUUID();
  await d.insert(schema.reports).values({ id: reportId, userId: p.id, status: "ready", fileName: "report.pdf", labName: "Demo Labs", collectedOn: "2026-11-02", nameOnReport: o.printed ?? "Demo Person", model: "mock", analyzedAt: new Date() });
  const markers = keys.map((key, i) => ({
    id: randomUUID(), reportId, userId: p.id, key, name: key, value: 10 + i * 7, unit: "ng/mL", refLow: 12, refHigh: 60, rangeSource: "report",
    status: i === 0 ? "low" : "in_range", flag: i === 0 ? (o.flag ?? null) : null, position: i,
  }));
  await d.insert(schema.markers).values(markers);
  const level = o.flag ? "doctor_first" : "go_with_tweaks";
  await d.insert(schema.analyses).values({
    reportId, userId: p.id,
    read: {
      headline: "A steady base", summary: "Demo read: most results sit in range.",
      verdict: { level, line: o.flag ? "Show a doctor before your next race." : "Ready, with one fix.", detail: "Demo read, written from a template." },
      focus: [{ marker_key: keys[0], title: "Lift it with food", why: "It matters for your training.", action: "Add a portion of greens each day." }],
      markers: markers.map((m) => ({ id: m.id, note: "Demo note." })), wins: ["Most results are in range."], doctor_questions: o.flag ? ["Ask about this result."] : [],
      retest: { weeks: 12, markers: [keys[0]], why: "To see it move." }, test_tips: ["Fast for 10 hours before the test."],
    },
  });
  return reportId;
}

async function mealsDays(p: Person) {
  for (const daysAgo of [0, 1, 2, 3]) for (const [slot, minutesAgo] of [["breakfast", 600], ["lunch", 300], ["dinner", 0]] as const) await meal(p, { daysAgo, slot, kcal: 650, minutesAgo, title: `Demo ${slot}`, model: "mock" });
}

const scenarios: Record<string, () => Promise<{ person: Person; reportId?: string }>> = {
  fresh: async () => ({ person: await person(`fresh-${randomUUID().slice(0, 6)}@demo.dhuman.local`, { name: "Asha" }) }),
  "no-report": async () => {
    const p = await person("noreport@demo.dhuman.local", { name: "Ravi", sex: "male", birthYear: 1998, heightCm: 175, weightKg: 72, primaryActivity: "strength", activities: ["strength"], diet: "nonveg" });
    await mealsDays(p);
    return { person: p };
  },
  report: async () => {
    const p = await person("report@demo.dhuman.local", { name: "Priya" });
    const reportId = await readReport(p, { printed: "Priya" });
    await meal(p, { model: "mock" });
    return { person: p, reportId };
  },
  urgent: async () => {
    const p = await person("urgent@demo.dhuman.local", { name: "Kiran" });
    return { person: p, reportId: await readReport(p, { flag: "urgent", printed: "Kiran" }) };
  },
  pregnancy: async () => {
    const p = await person("pregnant@demo.dhuman.local", { name: "Meera", conditions: ["pregnant"], healthCheckedAt: new Date() });
    return { person: p, reportId: await readReport(p, { printed: "Meera" }) };
  },
  "friend-report": async () => {
    const p = await person("friend@demo.dhuman.local", { name: "Asha Rao" });
    return { person: p, reportId: await readReport(p, { printed: "Vikram Singh" }) };
  },
  "meals-stack": async () => {
    const p = await person("mealstack@demo.dhuman.local", { name: "Dev", supplementBudget: "1000_2000", healthCheckedAt: new Date() });
    await mealsDays(p);
    const d = await db();
    await d.insert(schema.stacks).values({
      id: randomUUID(), userId: p.id, reportId: null, status: "ready", model: "rules",
      plan: {
        items: [{ nutrient: "Magnesium", dose: "200 mg a day", why: "Your meals run short of it.", markers: [], form: "Glycinate tablet", timing: "After dinner", duration: "8 weeks", rule: "magnesium", brands: [{ brand: "Demo Brand", product: "Magnesium glycinate", monthly_inr: 450 }] }],
        skip: [{ name: "Biotin", why: "Nothing points to it." }], food_first: ["A handful of nuts a day."], see_doctor: [],
        gaps: [{ key: "magnesium_mg", label: "Magnesium", pct: 45, outcome: "stack", note: "Your meals give about half of what you need.", rule: "magnesium" }],
        gaps_basis: { source: "logs", days: 3 }, inputs: { diet: "veg", medications: null, conditions: [] },
      },
    });
    return { person: p };
  },
};

const SCREENS = ["/api/me", "/api/home", "/api/fuel", "/api/fuel/past", "/api/fuel/facts", "/api/plan", "/api/upload", "/api/reports", "/api/stack", "/api/wraps", "/api/settings"];
const fileOf = (p: string) => p.replace(/^\/api\//, "").replace(/\{id\}/, "id").replace(/\//g, "-");

async function save(dir: string, name: string, p: string, r: { status: number; res: Response; body: Record<string, unknown> | null }, route: (typeof APP_ROUTES)[number]) {
  const schema = route.responses[r.status];
  if (schema === undefined) throw new Error(`${p}: ${r.status} isn't in the contract`);
  if (schema) schema.parse(r.body);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify({ status: r.status, etag: r.res.headers.get("etag"), body: r.body }, null, 2)}\n`);
}

try {
  rmSync(out, { recursive: true, force: true });
  let written = 0;
  for (const [name, make] of Object.entries(scenarios)) {
    const { person: p, reportId } = await make();
    for (const s of [...SCREENS, ...(reportId ? ["/api/reports/{id}/read"] : [])]) {
      const { route, fn } = await handler(s);
      const url = `https://www.d-human.fit${s.replace("{id}", reportId ?? "x")}${s === "/api/wraps" ? "?period=week" : ""}`;
      const r = await call(fn, { token: p.token, url, params: reportId ? { id: reportId } : undefined });
      await save(path.join(out, name), fileOf(s), s, r, route);
      written++;
    }
  }
  for (const s of ["/api/app/options", "/api/app/config"]) {
    const { route, fn } = await handler(s);
    await save(path.join(out, "public"), fileOf(s), s, await call(fn), route);
    written++;
  }
  // Refusals the app handles, from the real routes.
  const fresh = await person("errors@demo.dhuman.local", {}, false);
  const home = await handler("/api/home");
  const errors = path.join(out, "errors");
  mkdirSync(errors, { recursive: true });
  const keep = (n: string, r: { status: number; body: unknown }) => writeFileSync(path.join(errors, `${n}.json`), `${JSON.stringify({ status: r.status, body: r.body }, null, 2)}\n`);
  keep("401-signed-out", await call(home.fn, { token: "dht_not-a-real-token" }));
  keep("409-not-onboarded", await call(home.fn, { token: fresh.token }));
  keep("403-bearer-required", await call(home.fn, { cookie: fresh.cookie }));
  const food = (await import("../app/api/food/route.ts")).POST as Handler;
  const old = await person("old-consent@demo.dhuman.local", { consentAt: new Date("2026-11-01T00:00:00Z") });
  const form = (f: Record<string, string>) => Object.entries(f).reduce((fd, [k, v]) => (fd.append(k, v), fd), new FormData());
  keep("409-consent-needed", await call(food, { token: old.token, form: form({ text: "dal", source: "text" }) }));
  const busy = await person("limit@demo.dhuman.local");
  for (let i = 0; i < 5; i++) await call(food, { token: busy.token, form: form({ text: `meal ${i}`, source: "text" }) });
  keep("402-plan-limit", await call(food, { token: busy.token, form: form({ text: "one more", source: "text" }) }));
  keep("400-bad-time", await call(food, { token: busy.token, form: form({ text: "dal", source: "text", eatenAt: new Date(Date.now() - 72 * 3_600_000).toISOString() }) }));
  const tour = (await import("../app/api/profile/tour/route.ts")).POST as Handler;
  keep("403-not-for-app", await call(tour, { token: busy.token, body: {} }));
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {}
  writeFileSync(path.join(out, "SOURCE"), `${commit}\ncontract ${(await import("../lib/api/openapi.ts")).CONTRACT_VERSION}\nmade ${new Date().toISOString()} by scripts/app-fixtures.mts, demo people only, mock mode\n`);
  console.log(`wrote ${written} screens for ${Object.keys(scenarios).length} demo people, and 7 refusals, to ${path.relative(ROOT, out)}`);
} finally {
  console.info = quiet;
  await removeDatabase();
}

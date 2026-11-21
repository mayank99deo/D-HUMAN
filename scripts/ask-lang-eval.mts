// Ask's language eval, live: every case in tests/fixtures/ask-lang-eval.ts through the real
// code path (askPreCheck, then runAsk with the SDK), graded on the answer's language.
//
//   ASK_EVAL_LIVE=1 node --env-file=.env.local scripts/ask-lang-eval.mts [repeats=2] [case-id-prefix]
//
// It costs money (about $0.02 for two runs of 34 cases on Haiku 5.5), so it refuses to run
// without ASK_EVAL_LIVE=1 and stops itself past ASK_EVAL_BUDGET dollars (default 0.10).
// Results go to a JSON file in the system temp folder; the key is never printed.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { allowAppImports } from "../tests/support/app.ts";

if (process.env.ASK_EVAL_LIVE !== "1" || !process.env.ANTHROPIC_API_KEY) {
  console.error("The live eval costs money. Set ASK_EVAL_LIVE=1 and ANTHROPIC_API_KEY (e.g. node --env-file=.env.local) to run it.");
  process.exit(1);
}
allowAppImports();

const { askPreCheck, liveAskCaller, runAsk } = await import("../lib/ai/ask.ts");
const { costOf } = await import("../lib/ai/client.ts");
const { PEOPLE } = await import("../tests/fixtures/ask-people.ts");
const { LANG_CASES, gradeLang } = await import("../tests/fixtures/ask-lang-eval.ts");
type Case = (typeof LANG_CASES)[number];

const repeats = Number(process.argv[2] ?? 2);
const only = process.argv[3] ?? "";
const budget = Number(process.env.ASK_EVAL_BUDGET ?? 0.1);

type Row = { id: string; want: string; rep: number; ok: boolean; why: string; calls: number; retried: string | null; cost: number; secs: number; lang?: string; answer?: string };

let spent = 0;
async function one(c: Case, rep: number): Promise<Row> {
  const input = { question: c.q, about: null, earlier: [], data: PEOPLE[c.person], ...(c.spoken ? { spoken: c.spoken } : {}) };
  const base = { id: c.id, want: c.want, rep };
  if (askPreCheck(input)) return { ...base, ok: false, why: "answered by code before the model", calls: 0, retried: null, cost: 0, secs: 0 };
  const t0 = Date.now();
  const trace = await runAsk(input, { signal: AbortSignal.timeout(20_000), call: liveAskCaller });
  const secs = (Date.now() - t0) / 1000;
  const cost = trace.messages.reduce((n, m) => n + costOf(m), 0);
  spent += cost;
  const usage = { calls: trace.messages.length, retried: trace.retried, cost, secs };
  if (!trace.answer.ok || !trace.used) return { ...base, ...usage, ok: false, why: trace.answer.ok ? "no model answer" : trace.answer.error };
  const g = gradeLang(c, trace.used.answer, trace.used.lang);
  return { ...base, ...usage, ok: g.ok, why: g.why, lang: trace.used.lang, answer: trace.used.answer };
}

const cases = LANG_CASES.filter((c) => c.id.startsWith(only));
const jobs: [Case, number][] = [];
for (let r = 0; r < repeats; r++) for (const c of cases) jobs.push([c, r]);
const rows: Row[] = [];
let next = 0;
let stopped = false;
async function worker() {
  while (next < jobs.length) {
    if (spent > budget) {
      stopped = true;
      return;
    }
    const [c, r] = jobs[next++];
    const row = await one(c, r);
    rows.push(row);
    process.stdout.write(row.ok ? "." : "x");
  }
}
// The first call warms the shared cache, as real traffic would; the rest run four at a time.
if (jobs.length) {
  const [c, r] = jobs[next++];
  rows.push(await one(c, r));
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log();

const out = path.join(tmpdir(), `ask-lang-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(rows, null, 1));

const pct = (a: number, b: number) => `${a}/${b} (${b ? ((100 * a) / b).toFixed(1) : "0"}%)`;
const group = (id: string) => (id.startsWith("pick-") ? id.split("-").slice(0, 2).join("-") : id.split("-")[0]);
const groups = new Map<string, [number, number]>();
for (const r of rows) {
  const g = groups.get(group(r.id)) ?? [0, 0];
  groups.set(group(r.id), [g[0] + (r.ok ? 1 : 0), g[1] + 1]);
}
const called = rows.filter((r) => r.calls > 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`${stopped ? "STOPPED at the budget. " : ""}cases ${rows.length}: right language ${pct(rows.filter((r) => r.ok).length, rows.length)}`);
console.log(`by group: ${[...groups].map(([g, [a, b]]) => `${g} ${a}/${b}`).join(", ")}`);
console.log(`model calls ${called.reduce((n, r) => n + r.calls, 0)} for ${called.length} questions; retries: ${called.filter((r) => r.retried).map((r) => `${r.id}#${r.rep} ${r.retried}`).join(", ") || "none"}`);
console.log(`cost a question mean $${mean(called.map((r) => r.cost)).toFixed(6)}; latency mean ${mean(called.map((r) => r.secs)).toFixed(2)} s, max ${Math.max(0, ...called.map((r) => r.secs)).toFixed(2)} s`);
console.log(`spent $${spent.toFixed(4)}; results in ${out}`);
for (const r of rows.filter((r) => !r.ok)) console.log(`WRONG ${r.id}#${r.rep}: ${r.why} :: ${r.answer ?? ""}`);

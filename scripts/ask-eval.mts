// Ask's live eval: every case in tests/fixtures/ask-eval.ts through the real code path
// (askPreCheck, then runAsk with the SDK), graded, with tokens, cost and latency.
//
//   ASK_EVAL_LIVE=1 node --env-file=.env.local scripts/ask-eval.mts [repeats=2] [case-id-prefix]
//
// It costs money (about $0.03 for two runs of 58 cases on Haiku 5.5), so it refuses to run
// without ASK_EVAL_LIVE=1 and stops itself past ASK_EVAL_BUDGET dollars (default 0.06).
// Results go to a JSON file in the system temp folder; only counts are printed, never the key.

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
const { packText } = await import("../lib/domain/ask-context.ts");
const { ASK_LINK_IDS, ASK_TURN_KINDS } = await import("../lib/ask/types.ts");
const { ASK_TOPICS } = await import("../lib/domain/ask-floor.ts");
const { SPOKEN_IDS } = await import("../lib/domain/speech.ts");
const { PEOPLE } = await import("../tests/fixtures/ask-people.ts");
const { CASES, grade } = await import("../tests/fixtures/ask-eval.ts");
type Case = (typeof CASES)[number];

const repeats = Number(process.argv[2] ?? 2);
const only = process.argv[3] ?? "";
const budget = Number(process.env.ASK_EVAL_BUDGET ?? 0.06);
const PRICE = { in: 0.1, out: 0.5 }; // Haiku 5.5, $ per million tokens, for the uncached re-pricing

type Row = {
  id: string; group: string; rep: number; ok: boolean; safe: boolean; fails: string[]; minor: string[];
  precheck: boolean; kind?: string; modelKind?: string; raised?: boolean; filter?: string | null; retried?: string | null; error?: string;
  words?: number; offList?: number; calls: number; cacheRead: number; inTokens: number; outTokens: number; cost: number; uncached: number; secs: number;
  answer?: string | null; modelAnswer?: string; notice?: string[];
};

let spent = 0;
const offListOf = (text: string): number => {
  try {
    const r = JSON.parse(text);
    let n = 0;
    if (!(ASK_TURN_KINDS as readonly string[]).includes(r.kind)) n++;
    for (const t of r.topics ?? []) if (!(ASK_TOPICS as readonly string[]).includes(t)) n++;
    for (const l of r.links ?? []) if (!(ASK_LINK_IDS as readonly string[]).includes(l)) n++;
    if (!(SPOKEN_IDS as readonly string[]).includes(r.lang)) n++;
    return n;
  } catch {
    return 0;
  }
};

async function one(c: Case, rep: number): Promise<Row> {
  const data = PEOPLE[c.person];
  const input = { question: c.q, about: c.about ?? null, earlier: c.earlier ?? [], data };
  const pack = packText(data);
  const t0 = Date.now();
  const base = { id: c.id, group: c.group, rep, calls: 0, cacheRead: 0, inTokens: 0, outTokens: 0, cost: 0, uncached: 0 };
  const pre = askPreCheck(input);
  if (pre) {
    const g = grade(c, pre, null, pack);
    return { ...base, ok: !g.fails.length && !g.minor.length, safe: !g.fails.length, ...g, precheck: true, kind: pre.kind, secs: 0, notice: pre.notice?.lines };
  }
  const trace = await runAsk(input, { signal: AbortSignal.timeout(20_000), call: liveAskCaller });
  const secs = (Date.now() - t0) / 1000;
  let cost = 0, uncached = 0, cacheRead = 0, inTokens = 0, outTokens = 0, offList = 0;
  for (const m of trace.messages) {
    const u = m.usage;
    cost += costOf(m);
    const all = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    uncached += (all * PRICE.in + u.output_tokens * PRICE.out) / 1e6;
    cacheRead += u.cache_read_input_tokens ?? 0;
    inTokens += all;
    outTokens += u.output_tokens;
    offList += offListOf(m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""));
  }
  spent += cost;
  const usage = { ...base, calls: trace.messages.length, cacheRead, inTokens, outTokens, cost, uncached, secs, offList, retried: trace.retried };
  if (!trace.answer.ok) return { ...usage, ok: false, safe: false, fails: [trace.answer.error], minor: [], precheck: false, error: trace.answer.error };
  const reply = trace.answer.reply;
  const used = trace.used;
  const g = grade(c, reply, used, pack);
  return {
    ...usage, ...g, ok: !g.fails.length && !g.minor.length, safe: !g.fails.length, precheck: false,
    kind: reply.kind, modelKind: used?.kind, raised: reply.floorRaised, filter: reply.filter,
    words: used ? used.answer.trim().split(/\s+/).length : undefined, answer: reply.answer, modelAnswer: used?.answer, notice: reply.notice?.lines,
  };
}

const cases = CASES.filter((c) => c.id.startsWith(only));
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
    process.stdout.write(row.ok ? "." : row.safe ? "m" : "x");
  }
}
// The first model call warms the shared cache, as real traffic would; the rest run four at a time.
if (jobs.length) {
  const [c, r] = jobs[next++];
  rows.push(await one(c, r));
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log();

const out = path.join(tmpdir(), `ask-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(rows, null, 1));

const called = rows.filter((r) => r.calls > 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const pct = (a: number, b: number) => `${a}/${b} (${b ? ((100 * a) / b).toFixed(1) : "0"}%)`;
console.log(`${stopped ? "STOPPED at the budget. " : ""}cases ${rows.length}: strict ${pct(rows.filter((r) => r.ok).length, rows.length)}; no severe failure ${pct(rows.filter((r) => r.safe).length, rows.length)}`);
const groups = new Map<string, [number, number]>();
for (const r of rows) {
  const g = groups.get(r.group) ?? [0, 0];
  groups.set(r.group, [g[0] + (r.safe ? 1 : 0), g[1] + 1]);
}
console.log(`by group (no severe failure): ${[...groups].map(([g, [a, b]]) => `${g} ${a}/${b}`).join(", ")}`);
console.log(`answered by code before the model: ${rows.filter((r) => r.precheck).length}; model calls: ${called.reduce((n, r) => n + r.calls, 0)} for ${called.length} questions (retries: ${called.filter((r) => r.retried).map((r) => `${r.id}#${r.rep} ${r.retried}`).join(", ") || "none"})`);
console.log(`tokens in mean ${mean(called.map((r) => r.inTokens)).toFixed(0)}, out mean ${mean(called.map((r) => r.outTokens)).toFixed(0)} p95 ${q(called.map((r) => r.outTokens), 0.95)}; cache reads on ${called.filter((r) => r.cacheRead > 0).length}/${called.length}`);
console.log(`cost a question as billed: mean $${mean(called.map((r) => r.cost)).toFixed(6)} p95 $${q(called.map((r) => r.cost), 0.95).toFixed(6)}; uncached: mean $${mean(called.map((r) => r.uncached)).toFixed(6)} p95 $${q(called.map((r) => r.uncached), 0.95).toFixed(6)}`);
console.log(`latency mean ${mean(called.map((r) => r.secs)).toFixed(2)} s, p50 ${q(called.map((r) => r.secs), 0.5).toFixed(2)} s, p95 ${q(called.map((r) => r.secs), 0.95).toFixed(2)} s, max ${Math.max(0, ...called.map((r) => r.secs)).toFixed(2)} s`);
const w = called.filter((r) => r.words != null).map((r) => r.words!);
console.log(`model words mean ${mean(w).toFixed(1)}, max ${Math.max(0, ...w)}; values off their lists: ${called.reduce((n, r) => n + (r.offList ?? 0), 0)}; failed calls: ${rows.filter((r) => r.error).length}`);
console.log(`floor raised the kind on ${rows.filter((r) => r.raised).length}; filters tripped on ${rows.filter((r) => r.filter).length}: ${rows.filter((r) => r.filter).map((r) => `${r.id}#${r.rep} ${r.filter}`).join(", ") || "none"}`);
console.log(`spent $${spent.toFixed(4)}; results in ${out}`);
for (const r of rows.filter((r) => !r.safe)) console.log(`SEVERE ${r.id}#${r.rep}: ${r.fails.join("; ")}`);
for (const r of rows.filter((r) => r.safe && !r.ok)) console.log(`minor ${r.id}#${r.rep}: ${r.minor.join("; ")}`);

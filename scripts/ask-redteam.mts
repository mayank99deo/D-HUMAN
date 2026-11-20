// Ask's live red-team run (threats spec §6.3): every case in tests/fixtures/ask-redteam.ts
// through the real code path (askPreCheck, then runAsk with the SDK), graded on what the
// person would see. Synthetic people only.
//
//   ASK_REDTEAM_LIVE=1 node --env-file=.env.local scripts/ask-redteam.mts [repeats=1] [case-id-prefix]
//
// It costs money (about $0.0005 a model call on Haiku 5.5), so it refuses to run without
// ASK_REDTEAM_LIVE=1 and stops itself before ASK_REDTEAM_BUDGET dollars (default 0.55).
// Results, with every answer, go to a JSON file in the system temp folder (or ASK_REDTEAM_OUT);
// only counts and the failing answers are printed, never the key.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { allowAppImports } from "../tests/support/app.ts";

if (process.env.ASK_REDTEAM_LIVE !== "1" || !process.env.ANTHROPIC_API_KEY) {
  console.error("The red-team run costs money. Set ASK_REDTEAM_LIVE=1 and ANTHROPIC_API_KEY (e.g. node --env-file=.env.local) to run it.");
  process.exit(1);
}
delete process.env.D_HUMAN_AI_MOCK;
allowAppImports();

const { askPreCheck, liveAskCaller, runAsk } = await import("../lib/ai/ask.ts");
const { costOf } = await import("../lib/ai/client.ts");
const { RT_CASES, RT_PEOPLE, gradeRt } = await import("../tests/fixtures/ask-redteam.ts");
type Case = (typeof RT_CASES)[number];

const repeats = Number(process.argv[2] ?? 1);
const only = process.argv[3] ?? "";
const budget = Number(process.env.ASK_REDTEAM_BUDGET ?? 0.55);
/** The most one question can cost (two calls, the measured worst case with room): we stop before a call could pass the budget. */
const WORST_CALL = 0.004;

type Row = {
  id: string; group: string; rep: number; person: string; q: string;
  precheck: boolean; kind?: string; modelKind?: string; topics?: string[]; filter?: string | null; raised?: boolean; retried?: string | null; error?: string;
  breaks: string[]; tuning: string[]; listShould?: boolean;
  answer?: string | null; modelAnswer?: string; notice?: string[]; calls: number; cost: number; secs: number;
};

let spent = 0;
let stopped = false;

async function one(c: Case, rep: number): Promise<Row> {
  let data = RT_PEOPLE[c.person];
  if (c.plant) data = c.plant(data);
  const input = { question: c.q, about: c.about ?? null, earlier: c.earlier ?? [], data };
  const base = { id: c.id, group: c.group, rep, person: c.person, q: c.q, listShould: c.listShould, calls: 0, cost: 0 };
  const pre = askPreCheck(input);
  if (pre) {
    const g = gradeRt(c, pre, data);
    return { ...base, ...g, precheck: true, kind: pre.kind, notice: pre.notice?.lines, secs: 0 };
  }
  const t0 = Date.now();
  const trace = await runAsk(input, { signal: AbortSignal.timeout(20_000), call: liveAskCaller });
  const cost = trace.messages.reduce((s, m) => s + costOf(m), 0);
  spent += cost;
  const usage = { ...base, calls: trace.messages.length, cost, secs: (Date.now() - t0) / 1000, retried: trace.retried };
  if (!trace.answer.ok) return { ...usage, precheck: false, error: trace.answer.error, breaks: [], tuning: [`nothing shown: ${trace.answer.error}`] };
  const reply = trace.answer.reply;
  const g = gradeRt(c, reply, data);
  return {
    ...usage, ...g, precheck: false, kind: reply.kind, modelKind: trace.used?.kind, topics: trace.used?.topics, filter: reply.filter, raised: reply.floorRaised,
    answer: reply.answer, modelAnswer: trace.used?.answer, notice: reply.notice?.lines,
  };
}

const cases = RT_CASES.filter((c) => c.id.startsWith(only));
const jobs: [Case, number][] = [];
for (let r = 0; r < repeats; r++) for (const c of cases) jobs.push([c, r]);
const rows: Row[] = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    // Four calls can be in flight; stop while every one of them still fits the budget.
    if (spent + 4 * WORST_CALL > budget) {
      stopped = true;
      return;
    }
    const [c, r] = jobs[next++];
    const row = await one(c, r);
    rows.push(row);
    process.stdout.write(row.breaks.length ? "x" : row.tuning.length ? "m" : ".");
  }
}
if (jobs.length) {
  const [c, r] = jobs[next++];
  rows.push(await one(c, r));
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log();

const out = process.env.ASK_REDTEAM_OUT ?? path.join(tmpdir(), `ask-redteam-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(rows, null, 1));

const groups = new Map<string, { n: number; breaks: number; tuning: number; code: number }>();
for (const r of rows) {
  const g = groups.get(r.group) ?? { n: 0, breaks: 0, tuning: 0, code: 0 };
  g.n++;
  if (r.breaks.length) g.breaks++;
  if (r.tuning.length) g.tuning++;
  if (r.precheck) g.code++;
  groups.set(r.group, g);
}
const called = rows.filter((r) => r.calls > 0);
console.log(`${stopped ? "STOPPED before the budget. " : ""}cases run ${rows.length} of ${jobs.length}; model calls ${called.reduce((n, r) => n + r.calls, 0)}; answered by code first ${rows.filter((r) => r.precheck).length}`);
console.log(`floor breaks: ${rows.filter((r) => r.breaks.length).length}`);
console.log("by group (cases, breaks, off the hoped kind or for review, answered by code first):");
for (const [g, v] of groups) console.log(`  ${g.padEnd(13)} ${String(v.n).padStart(3)}  breaks ${v.breaks}  tuning ${v.tuning}  code ${v.code}`);
const off = rows.filter((r) => r.group === "off_topic");
console.log(`off-topic redirected: ${off.filter((r) => r.kind === "off_topic").length}/${off.length}`);
const ok = rows.filter((r) => r.group === "helpful");
console.log(`ordinary questions answered (answer or doctor with text): ${ok.filter((r) => r.answer && (r.kind === "answer" || r.kind === "doctor")).length}/${ok.length}`);
const nets = rows.filter((r) => r.group === "crisis" || r.group === "emergency");
console.log(`crisis and emergency: code's list ${nets.filter((r) => r.precheck).length}, model only ${nets.filter((r) => !r.precheck && (r.kind === "crisis" || r.kind === "urgent")).length}, neither ${nets.filter((r) => !r.precheck && r.kind !== "crisis" && r.kind !== "urgent").length} (of ${nets.length})`);
console.log(`spent $${spent.toFixed(4)} (budget $${budget}); results in ${out}`);
for (const r of rows.filter((r) => r.breaks.length)) console.log(`BREAK ${r.id}#${r.rep} [${r.kind}${r.modelKind ? `, model ${r.modelKind}` : ""}]: ${r.breaks.join("; ")} | shown: ${JSON.stringify(r.answer ?? null)}`);
for (const r of rows.filter((r) => !r.breaks.length && r.tuning.length)) console.log(`tuning ${r.id}#${r.rep} [${r.kind}]: ${r.tuning.join("; ")}${r.answer ? ` | shown: ${JSON.stringify(r.answer).slice(0, 160)}` : ""}`);

// Translating a stack for Hindi and Hinglish readers (lib/ai/stack.ts, translatePlan): the
// food gaps' notes are translated, and a reply that changes the gaps' count, order or
// outcomes falls back to the English plan. The model call is a stub that returns whatever
// the test puts in globalThis.__reply.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

const g = globalThis as unknown as { __reply?: unknown; __calls: number };
g.__calls = 0;

allowAppImports({
  // lib/ai/stack.ts imports its client as "./client".
  "./client": `
    export const MODELS = { wrap: "claude-haiku-test" };
    export const VOICE = "";
    export const anthropic = () => ({ beta: { messages: { stream: () => {
      globalThis.__calls++;
      return { finalMessage: async () => ({ model: "claude-haiku-test", parsed_output: globalThis.__reply }) };
    } } } });
    export const assertComplete = () => {};
    export const extractJson = () => null;
    export const fallbackFor = () => ({});
    export const languageRule = () => "";
    export const logUsage = () => {};
    export const runWithWebSearch = async () => { throw new Error("No web search in a test"); };
  `,
  "@anthropic-ai/sdk/helpers/beta/zod": "export const betaZodOutputFormat = (schema) => ({ schema });",
});
const { translatePlan } = await import("../lib/ai/stack.ts");
type Plan = Parameters<typeof translatePlan>[0];

const english: Plan = {
  items: [],
  skip: [{ name: "Multivitamin", why: "Nothing in your results or meals points to one." }],
  food_first: [],
  see_doctor: [],
  gaps: [
    { key: "vitamin_d_iu", label: "Vitamin D", pct: 21, outcome: "test", note: "Food is a small source; sunlight makes most of it.", rule: null },
    { key: "calcium_mg", label: "Calcium", pct: 30, outcome: "food", note: "Curd, paneer, ragi, til and leafy greens.", rule: null },
  ],
  gaps_basis: { source: "typical_day", days: 0 },
};
const hinglish = {
  items: [],
  skip: [{ name: "Multivitamin", why: "Aapke results ya meals mein iski zaroorat nahi dikhti." }],
  food_first: [],
  see_doctor: [],
  gaps: [
    { key: "vitamin_d_iu", outcome: "test", note: "Khaane se thoda hi milta hai; zyada dhoop se banta hai." },
    { key: "calcium_mg", outcome: "food", note: "Dahi, paneer, ragi, til aur hari sabziyan." },
  ],
};

describe("translating a stack's food gaps", () => {
  beforeEach(() => {
    g.__calls = 0;
  });

  it("translates the notes and keeps keys, numbers, outcomes and the basis", async () => {
    g.__reply = hinglish;
    const { plan, model } = await translatePlan(english, "hinglish");
    assert.equal(model, "claude-haiku-test");
    assert.deepEqual(
      plan.gaps?.map((x) => x.note),
      hinglish.gaps.map((x) => x.note),
    );
    assert.deepEqual(
      plan.gaps?.map(({ key, label, pct, outcome, rule }) => ({ key, label, pct, outcome, rule })),
      english.gaps?.map(({ key, label, pct, outcome, rule }) => ({ key, label, pct, outcome, rule })),
    );
    assert.deepEqual(plan.gaps_basis, english.gaps_basis);
    assert.equal(plan.skip[0].why, hinglish.skip[0].why);
  });

  it("falls back to English when a gap goes missing", async () => {
    g.__reply = { ...hinglish, gaps: hinglish.gaps.slice(0, 1) };
    const { plan, model } = await translatePlan(english, "hinglish");
    assert.equal(model, null);
    assert.equal(plan, english);
  });

  it("falls back to English when an outcome changes", async () => {
    g.__reply = { ...hinglish, gaps: [hinglish.gaps[0], { ...hinglish.gaps[1], outcome: "stack" }] };
    const { plan, model } = await translatePlan(english, "hindi");
    assert.equal(model, null);
    assert.equal(plan, english);
  });

  it("falls back to English when the gaps come back in another order", async () => {
    g.__reply = { ...hinglish, gaps: [...hinglish.gaps].reverse() };
    assert.equal((await translatePlan(english, "hindi")).plan, english);
  });

  it("translates a plan with only food gaps, and never calls the model for English", async () => {
    g.__reply = { ...hinglish, skip: [] };
    const onlyGaps = { ...english, skip: [] };
    assert.equal((await translatePlan(onlyGaps, "hinglish")).model, "claude-haiku-test");
    assert.equal(g.__calls, 1);
    assert.equal((await translatePlan(english, "en")).plan, english);
    assert.equal(g.__calls, 1, "no call for English");
  });

  it("leaves an older stack without gaps as it was", async () => {
    const older: Plan = { items: [], skip: english.skip, food_first: [], see_doctor: [] };
    g.__reply = { ...hinglish, gaps: [] };
    const { plan, model } = await translatePlan(older, "hinglish");
    assert.equal(model, "claude-haiku-test");
    assert.equal(plan.gaps, undefined);
    assert.equal(plan.skip[0].why, hinglish.skip[0].why);
  });
});

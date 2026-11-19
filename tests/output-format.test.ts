// The structured-output schemas for meals, the usual day, report extraction, the read and
// wraps (lib/ai/output-format.ts): the same schema the SDK helper sent before, except that
// every enum is now a real `enum` the API enforces instead of text in a description. Parsing
// is unchanged.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnthropicError } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { strictOutputFormat } = await import("../lib/ai/output-format.ts");
const S = await import("../lib/ai/schemas.ts");
const { FOOD_CODES } = await import("../lib/domain/food-table.ts");
const { EXTRACT_KEYS } = await import("../lib/domain/markers.ts");
const { SPOKEN_IDS } = await import("../lib/domain/speech.ts");

type Node = Record<string, unknown>;
const SCHEMAS = { meal: S.MealSchema, day: S.DaySchema, extract: S.ExtractedSchema, read: S.ReadSchema, wrap: S.WrapStorySchema };

/** Ours, rewritten the way the helper writes it: enum and const moved into the description, $schema in the root's. */
function asHelperWrites(node: unknown, root = true, schemaUri?: string): unknown {
  if (Array.isArray(node)) return node.map((n) => asHelperWrites(n, false));
  if (!node || typeof node !== "object") return node;
  const n = { ...(node as Node) };
  const moved: string[] = [];
  if (root && schemaUri) moved.push(`$schema: ${JSON.stringify(schemaUri)}`);
  for (const k of ["enum", "const"]) {
    if (k in n) {
      moved.push(`${k}: ${JSON.stringify(n[k])}`);
      delete n[k];
    }
  }
  const out: Node = {};
  for (const [k, v] of Object.entries(n)) out[k] = k === "properties" || k === "$defs" ? Object.fromEntries(Object.entries(v as Node).map(([pk, pv]) => [pk, asHelperWrites(pv, false)])) : asHelperWrites(v, false);
  if (moved.length) out.description = `${out.description ? `${out.description}\n\n` : ""}{${moved.join(", ")}}`;
  return out;
}
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Node).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v;
const at = (schema: unknown, path: string[]) => path.reduce<unknown>((n, k) => (n as Node)?.[k], schema) as Node;
const walk = (n: unknown, f: (n: Node) => void): void => {
  if (Array.isArray(n)) n.forEach((x) => walk(x, f));
  else if (n && typeof n === "object") {
    f(n as Node);
    Object.values(n as Node).forEach((x) => walk(x, f));
  }
};

describe("structured output formats", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    it(`${name}: the helper's schema exactly, with enums as keywords`, () => {
      const ours = strictOutputFormat(schema).schema;
      const helper = betaZodOutputFormat(schema).schema;
      const uri = /\$schema: "([^"]+)"/.exec(String(helper.description ?? ""))?.[1];
      assert.deepEqual(sortKeys(asHelperWrites(ours, true, uri)), sortKeys(helper));
      walk(ours, (n) => {
        assert.ok(!String(n.description ?? "").includes("enum:"), "no enum left in a description");
        if (n.type === "object") assert.equal(n.additionalProperties, false);
      });
    });
  }

  it("enforces the lists that used to be text", () => {
    const meal = strictOutputFormat(S.MealSchema).schema;
    assert.deepEqual(at(meal, ["properties", "reply_language", "enum"]), [...SPOKEN_IDS]);
    assert.deepEqual(at(meal, ["properties", "confidence", "enum"]), ["high", "medium", "low"]);
    let food: unknown[] | undefined;
    walk(meal, (n) => {
      const f = (n.properties as Node | undefined)?.food as Node | undefined;
      if (f?.enum) food = f.enum as unknown[];
    });
    assert.deepEqual(food, [...FOOD_CODES, "other"]);
    let key: unknown[] | undefined;
    walk(strictOutputFormat(S.ExtractedSchema).schema, (n) => {
      const k = (n.properties as Node | undefined)?.key as Node | undefined;
      if (k?.enum) key = k.enum as unknown[];
    });
    assert.deepEqual(key, [...EXTRACT_KEYS, "other"]);
    assert.deepEqual(at(strictOutputFormat(S.ReadSchema).schema, ["properties", "verdict", "properties", "level", "enum"]), ["go", "go_with_tweaks", "build", "doctor_first"]);
    let kinds: unknown[] | undefined;
    walk(strictOutputFormat(S.WrapStorySchema).schema, (n) => {
      const k = (n.properties as Node | undefined)?.kind as Node | undefined;
      if (k?.enum) kinds = k.enum as unknown[];
    });
    assert.deepEqual(kinds, ["stat", "streak", "food", "gap", "marker", "win", "next"]);
  });

  it("parses exactly as the helper does, and throws the same error on a value off the list", () => {
    const story = { title: "Week", cards: [{ kind: "stat", big: "5", label: "days", line: "Five days logged." }], one_thing: "Add curd." };
    const ours = strictOutputFormat(S.WrapStorySchema);
    const helper = betaZodOutputFormat(S.WrapStorySchema);
    assert.deepEqual(ours.parse(JSON.stringify(story)), helper.parse(JSON.stringify(story)));
    const bad = JSON.stringify({ ...story, cards: [{ ...story.cards[0], kind: "trophy" }] });
    assert.throws(() => ours.parse(bad), AnthropicError);
    assert.throws(() => helper.parse(bad), AnthropicError);
    assert.throws(() => ours.parse("{not json"), SyntaxError);
  });
});

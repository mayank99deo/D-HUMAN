// QA, 2026-11-22: a logged meal's Delete (Today on Fuel, every day in Past meals) was 41 px wide
// at 320, 390 and 1440 px: tall enough (min-h-11), but narrower than the 44 px every control gets.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { allowAppImports } from "./support/app.ts";
import { allowTsx } from "./support/tsx.ts";

allowAppImports();
allowTsx();
const { MealRow } = await import("../components/platform/MealRow.tsx");

describe("a logged meal's Delete", () => {
  it("is at least 44 px both ways, and stays flush right under the numbers", () => {
    const meal = { id: "m1", meal: "lunch", title: "Rajma chawal", source: "text", kcal: 520, proteinG: 18, confidence: "medium", tip: null, items: ["Rajma, 1 katori"], demo: false };
    const out = renderToStaticMarkup(createElement("ul", null, createElement(MealRow, { meal, deleting: false, disabled: false, onDelete: () => {} })));
    const button = out.match(/<button[^>]*aria-label="Delete Rajma chawal"[^>]*>/)?.[0] ?? "";
    assert.ok(button, out);
    const cls = button.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    assert.ok(cls.includes("min-h-11"), `tall enough: ${cls.join(" ")}`);
    assert.ok(cls.includes("min-w-11"), `wide enough: ${cls.join(" ")}`);
    assert.ok(cls.includes("text-right"), `flush right: ${cls.join(" ")}`);
  });
});

// Fitting a stack to a monthly budget (lib/domain/budget.ts): the most important
// items first at their cheapest good brand, then the best brands the rest allows.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUDGET_IDS, budgetOf, fitBudget, monthlyInr, rupees, type PricedItem } from "../lib/domain/budget.ts";

// Brands come best first, as the search lists them.
const item = (rule: string, ...monthly: (number | null)[]): PricedItem => ({ rule, brands: monthly.map((m) => ({ monthly_inr: m })) });

describe("budgets", () => {
  it("has seven slabs, from under ₹1,000 to above ₹5,000, plus not sure", () => {
    assert.deepEqual(BUDGET_IDS, ["under_1000", "1000_2000", "2000_3000", "3000_4000", "4000_5000", "5000_plus", "not_sure"]);
    assert.equal(budgetOf("2000_3000")?.cap, 3000);
    assert.equal(budgetOf("5000_plus")?.cap, null);
    assert.equal(budgetOf("bogus"), null);
  });

  it("turns a pack price into a month at the dose, and drops odd numbers", () => {
    assert.equal(monthlyInr(600, 60), 300);
    assert.equal(monthlyInr(2400, 30), 2400);
    assert.equal(monthlyInr(null, 30), null);
    assert.equal(monthlyInr(600, 1), null); // a pack that lasts a day isn't a pack
    assert.equal(monthlyInr(5, 30), null);
    assert.equal(monthlyInr("600", 60), null);
  });

  it("gives everything the best brand when the budget is open", () => {
    const items = [item("vitamin_d3", 500, 200), item("magnesium", 1400, 700)];
    for (const b of ["5000_plus", "not_sure", null]) {
      const fit = fitBudget(items, b);
      assert.deepEqual(fit.included, [0, 1]);
      assert.deepEqual(fit.pick, [0, 0]);
      assert.equal(fit.total, 1900);
    }
  });

  it("covers the most important first, then upgrades brands with what's left", () => {
    // D3: best ₹500, value ₹200. Magnesium: best ₹1,400, value ₹700. Protein: ₹2,600 or ₹1,900.
    const items = [item("vitamin_d3", 500, 200), item("magnesium", 1400, 700), item("protein", 2600, 1900)];
    const fit = fitBudget(items, "1000_2000");
    // Coverage: D3 ₹200 + magnesium ₹700 = ₹900; protein's ₹1,900 doesn't fit in ₹2,000.
    assert.deepEqual(fit.included, [0, 1]);
    assert.deepEqual(fit.later, [2]);
    // Upgrades in priority order: D3 to ₹500 (₹1,200), then magnesium to ₹1,400 would be ₹1,900: fits.
    assert.deepEqual(fit.pick.slice(0, 2), [0, 0]);
    assert.equal(fit.total, 1900);
    assert.ok(fit.total <= 2000);
  });

  it("keeps the cheaper brand when the better one would break the budget", () => {
    const fit = fitBudget([item("vitamin_d3", 500, 200), item("magnesium", 1400, 700)], "under_1000");
    assert.deepEqual(fit.included, [0, 1]);
    // ₹200 + ₹700 = ₹900; D3 at ₹500 would make ₹1,200.
    assert.deepEqual(fit.pick, [1, 1]);
    assert.equal(fit.total, 900);
  });

  it("skips an item that doesn't fit but still fits the cheaper ones after it", () => {
    const fit = fitBudget([item("protein", 2600, 1900), item("b12", 300, 150)], "under_1000");
    assert.deepEqual(fit.included, [1]);
    assert.deepEqual(fit.later, [0]);
    assert.equal(fit.pick[1], 0); // ₹300 fits, so the better B12
  });

  it("uses typical prices when no brand has one, and marks them", () => {
    const fit = fitBudget([item("magnesium"), { rule: "b12", brands: [{ monthly_inr: null }] }], "under_1000");
    assert.deepEqual(fit.included, [0, 1]);
    assert.deepEqual(fit.typical, [true, true]);
    assert.deepEqual(fit.cost, [500, 120]);
    assert.deepEqual(fit.pick, [null, null]);
  });

  it("prices older stacks, which have no rule, by the supplement's name", () => {
    const fit = fitBudget([{ nutrient: "Vitamin D3", brands: [] }, { nutrient: "Iron (only if your doctor agrees)", brands: [] }], "under_1000");
    assert.deepEqual(fit.cost, [150, 150]);
    assert.deepEqual(fit.typical, [true, true]);
  });

  it("includes old items it can't price", () => {
    const fit = fitBudget([{ brands: [] }], "under_1000");
    assert.deepEqual(fit.included, [0]);
    assert.equal(fit.cost[0], null);
    assert.equal(fit.total, 0);
  });

  it("writes rupees the Indian way", () => {
    assert.equal(rupees(1240), "₹1,240");
    assert.equal(rupees(125000), "₹1,25,000");
  });
});

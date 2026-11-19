// The wrap's numbers (wrapStatsFrom in lib/platform/wraps.ts) and the meal-slot fix: a
// peanut-butter toast logged as a snack at 18:10 every day was called "your go-to
// breakfast" (MEMORY open item, 2026-11-13). Now each top food carries the slot it was
// logged as and its usual time, and the prompt lets the model name a slot only from them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { wrapDays, wrapStatsFrom } = await import("../lib/platform/wraps.ts");
const { SYSTEM, wrapMessage } = await import("../lib/ai/wrap.ts");
const { targetsFor } = await import("../lib/domain/nutrition.ts");

// Real targets for a 32-year-old, with protein set to 100 g so the 90% rule is easy to read.
const targets = { ...targetsFor({ sex: "female", age: 32, heightCm: 160, weightKg: 60, level: "regular", archetype: "strength", goals: [] }), proteinG: 100 };

type Log = Parameters<typeof wrapStatsFrom>[0]["logs"][number];
const log = (localDate: string, utcTime: string, o: Partial<Log> = {}): Log => ({
  localDate,
  meal: "lunch",
  source: "photo",
  title: "Dal rice",
  kcal: 500,
  proteinG: 20,
  carbsG: 60,
  fatG: 10,
  fibreG: 5,
  micros: {},
  createdAt: new Date(`${localDate}T${utcTime}Z`),
  ...o,
});

// The film's data: toast as a snack at 18:10 IST (12:40 UTC) every day, plus a lunch.
const week = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].flatMap((day) => [
  log(day, "12:40:00", { title: "Peanut butter toast", meal: "snack", proteinG: 12 }),
  log(day, "07:30:00", { title: "Dal rice", meal: "lunch", proteinG: 18 }),
]);

describe("wrap stats", () => {
  it("each top food carries the slot it was logged as and its usual time, in their zone", () => {
    const stats = wrapStatsFrom({ start: "2026-11-16", end: "2026-11-22", logs: week, targets, timezone: "Asia/Kolkata", reportsInPeriod: 0 });
    const toast = stats.topFoods.find((f) => f.title === "Peanut butter toast");
    assert.deepEqual(toast, { title: "Peanut butter toast", times: 5, meal: "snack", usualTime: "18:10" });
    assert.equal(stats.topFoods.find((f) => f.title === "Dal rice")?.meal, "lunch");
  });

  it("the prompt passes the slot and tells the model never to guess one", () => {
    const stats = wrapStatsFrom({ start: "2026-11-16", end: "2026-11-22", logs: week, targets, timezone: "Asia/Kolkata", reportsInPeriod: 0 });
    const message = wrapMessage({ period: "week", label: "16 Nov – 22 Nov", persona: "Regular lifter", firstName: "Mayank", goals: [], stats, language: "en" });
    assert.match(message, /"title": "Peanut butter toast",\s+"times": 5,\s+"meal": "snack",\s+"usualTime": "18:10"/);
    assert.match(SYSTEM, /only as its "meal" says/);
    assert.match(SYSTEM, /Never guess the slot from what the food is or from the time/);
  });

  it("counts the same as before: days, meals, protein days, streak, sources", () => {
    const logs = [
      log("2026-11-16", "07:00:00", { proteinG: 95 }),
      log("2026-11-17", "07:00:00", { proteinG: 40, source: "voice" }),
      log("2026-11-17", "13:00:00", { proteinG: 50, source: "voice" }),
      log("2026-11-19", "07:00:00", { proteinG: 30, source: "text" }),
      log("2026-11-25", "07:00:00", { proteinG: 99 }), // outside the week: left out
    ];
    const stats = wrapStatsFrom({ start: "2026-11-16", end: "2026-11-22", logs, targets, timezone: null, reportsInPeriod: 1 });
    assert.equal(stats.daysLogged, 3);
    assert.equal(stats.mealsLogged, 4);
    assert.equal(stats.proteinTargetHitDays, 2, "95 g and 90 g both reach 90% of 100 g");
    assert.equal(stats.longestStreakDays, 2);
    assert.deepEqual(stats.loggedBy, { photo: 1, voice: 2, text: 1 });
    assert.equal(stats.reportsInPeriod, 1);
    assert.deepEqual(stats.markersMoved, []);
    assert.ok(stats.lowestMicros.every((m) => Number.isFinite(m.pctOfTarget)));
  });

  it("the per-day list has every day of the week, Monday first, with the same protein rule", () => {
    const days = wrapDays([log("2026-11-16", "07:00:00", { proteinG: 95 }), log("2026-11-18", "07:00:00", { proteinG: 30 })], 100, "2026-11-16", "2026-11-22");
    assert.equal(days.length, 7);
    assert.deepEqual(days.map((d) => [d.date.slice(8), d.logged, d.proteinReached]), [
      ["16", true, true],
      ["17", false, false],
      ["18", true, false],
      ["19", false, false],
      ["20", false, false],
      ["21", false, false],
      ["22", false, false],
    ]);
  });
});

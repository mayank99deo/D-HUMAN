// Ask's starters: fixed questions picked by code for each screen (UX spec §5), in the read
// language. A flagged marker never gets a food question, and under an urgent hold only app
// questions show. "Ask about this" prefills follow the same table and never send.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const S = await import("../components/platform/ask-starters.ts");
const { ACTIVITY_IDS } = await import("../lib/domain/options.ts");
type Facts = import("../lib/ask/types.ts").AskStarterFacts;

const LANGS = ["en", "hi", "hinglish"] as const;
const facts = (over: Partial<Facts> = {}): Facts => ({
  archetype: "running",
  flagged: null,
  foodMarker: null,
  proteinLeftG: null,
  mealsToday: 0,
  mealsEver: true,
  hasGaps: false,
  stackItem: null,
  ...over,
});
const pick = (path: string, f: Facts, extra: { report?: "none" | "reading" | "ready"; urgent?: boolean; lang?: "en" | "hi" | "hinglish" } = {}) =>
  S.pickStarters({ path, facts: f, report: extra.report ?? "ready", urgent: extra.urgent ?? false, lang: extra.lang ?? "en" });
const keys = (xs: { key: string }[]) => xs.map((x) => x.key);

describe("the starter table", () => {
  it("has every starter in all three read languages, with the same slots", () => {
    for (const [id, words] of Object.entries(S.STARTERS)) {
      const slots = (t: string) => (t.match(/\{[a-z]+\}/g) ?? []).sort().join();
      for (const lang of LANGS) assert.ok(words[lang].trim(), `${id} ${lang}`);
      assert.equal(slots(words.hi), slots(words.en), `${id} hi`);
      assert.equal(slots(words.hinglish), slots(words.en), `${id} hinglish`);
    }
  });

  it("has a persona starter for every activity", () => {
    for (const a of ACTIVITY_IDS) for (const lang of LANGS) assert.ok(S.PERSONA_STARTERS[a][lang], `${a} ${lang}`);
    assert.equal(S.personaStarter("unknown-sport", "en").text, S.PERSONA_STARTERS.starting.en);
  });

  it("fills the slot and leaves no braces behind", () => {
    assert.equal(S.starterText({ id: "eat_for", slot: "Vitamin D" }, "en"), "What should I eat for my Vitamin D?");
    assert.equal(S.starterText({ id: "protein_left", slot: "35" }, "hinglish"), "Aaj 35 g protein aur kaise lun?");
    assert.equal(S.starterText({ id: "why_item", slot: "Magnesium" }, "hi"), "Magnesium मेरे स्टैक में क्यों है?");
    for (const id of Object.keys(S.STARTERS) as (keyof typeof S.STARTERS)[]) assert.doesNotMatch(S.starterText({ id, slot: "X" }, "en"), /[{}]/);
  });

  it("never names a brand, says 'free' or diagnoses", () => {
    const all = [...Object.values(S.STARTERS), ...Object.values(S.PERSONA_STARTERS)].flatMap((w) => Object.values(w)).join("\n");
    assert.doesNotMatch(all, /\bfree\b|\byou have\b|accurate/i);
  });
});

describe("screens", () => {
  it("knows each screen from its path", () => {
    const cases: [string, string][] = [
      ["/home", "home"],
      ["/reports", "home"],
      ["/reports/0d2c3c5e-0000-4000-8000-000000000000", "report"],
      ["/fuel", "fuel"],
      ["/fuel/past", "fuel"],
      ["/stack", "stack"],
      ["/upload", "upload"],
      ["/settings", "settings"],
      ["/wraps", "wraps"],
      ["/write", "other"],
    ];
    for (const [path, screen] of cases) assert.equal(S.screenOf(path), screen, path);
  });
});

describe("picks: three, the screen's first two that apply, then the persona's", () => {
  it("always gives three distinct starters", () => {
    for (const path of ["/home", "/reports/x", "/fuel", "/fuel/past", "/stack", "/upload", "/settings", "/wraps", "/other"]) {
      for (const f of [facts(), facts({ flagged: { name: "Haemoglobin" }, stackItem: "Magnesium", mealsToday: 2, proteinLeftG: 35 })]) {
        for (const report of ["none", "ready"] as const) {
          const got = pick(path, f, { report });
          assert.equal(got.length, 3, `${path} ${report}`);
          assert.equal(new Set(keys(got)).size, 3);
          assert.equal(got[2].key, "persona:running");
        }
      }
    }
  });

  it("Home with a report: a doctor question for a flagged marker, never a food one", () => {
    const got = pick("/home", facts({ flagged: { name: "Vitamin D" }, foodMarker: { name: "Ferritin" } }));
    assert.deepEqual(keys(got), ["ask_doctor", "matters", "persona:running"]);
    assert.equal(got[0].text, "What should I ask a doctor about my Vitamin D?");
    assert.ok(!got.some((s) => s.key === "eat_for"));
  });

  it("Home with a report: a food question for an edge marker that isn't flagged", () => {
    assert.deepEqual(keys(pick("/home", facts({ foodMarker: { name: "Ferritin" } }))), ["eat_for", "matters", "persona:running"]);
    assert.deepEqual(keys(pick("/home", facts())), ["matters", "retest", "persona:running"]);
  });

  it("the report page picks like Home", () => {
    assert.deepEqual(keys(pick("/reports/abc", facts({ flagged: { name: "eGFR" } }))), ["ask_doctor", "matters", "persona:running"]);
  });

  it("Home with no ready report", () => {
    assert.deepEqual(keys(pick("/home", facts(), { report: "none" })), ["report_shows", "how_upload", "persona:running"]);
    assert.deepEqual(keys(pick("/home", facts(), { report: "reading" })), ["report_shows", "how_upload", "persona:running"]);
    assert.deepEqual(keys(pick("/home", facts({ foodMarker: { name: "Ferritin" } }), { report: "reading" })).slice(0, 1), ["eat_for"], "a newer one reading over an older ready one");
  });

  it("Fuel: protein left, else how meals are counted; then next meal, else gaps", () => {
    assert.deepEqual(keys(pick("/fuel", facts({ proteinLeftG: 35, mealsToday: 1 }))), ["protein_left", "next_meal", "persona:running"]);
    assert.equal(pick("/fuel", facts({ proteinLeftG: 35, mealsToday: 1 }), { lang: "hinglish" })[0].text, "Aaj 35 g protein aur kaise lun?");
    assert.deepEqual(keys(pick("/fuel", facts({ mealsEver: false }))), ["how_counted", "matters", "persona:running"]);
    assert.deepEqual(keys(pick("/fuel/past", facts({ hasGaps: true }))), ["gaps", "matters", "persona:running"]);
    assert.deepEqual(keys(pick("/fuel", facts({ proteinLeftG: 5, mealsToday: 1 }))).slice(0, 1), ["next_meal"], "under 10 g isn't offered");
  });

  it("Stack: the first item's why and foods, else how it's built", () => {
    const got = pick("/stack", facts({ stackItem: "Magnesium" }));
    assert.deepEqual(keys(got), ["why_item", "food_for", "persona:running"]);
    assert.equal(got[0].text, "Why is Magnesium in my stack?");
    assert.deepEqual(keys(pick("/stack", facts())), ["how_built", "matters", "persona:running"]);
  });

  it("Upload, Settings and Wraps", () => {
    assert.deepEqual(keys(pick("/upload", facts())), ["which_reports", "who_sees", "persona:running"]);
    assert.deepEqual(keys(pick("/settings", facts())), ["pass", "language", "persona:running"]);
    assert.deepEqual(keys(pick("/wraps", facts())), ["one_change", "matters", "persona:running"]);
  });

  it("speaks the read language, with marker names in English", () => {
    const hi = pick("/home", facts({ flagged: { name: "Vitamin D" } }), { lang: "hi" });
    assert.equal(hi[0].text, "डॉक्टर से मेरे Vitamin D के बारे में क्या पूछूँ?");
    assert.equal(hi[2].text, "सुबह की दौड़ से पहले क्या खाऊँ?");
    const hinglish = pick("/upload", facts({ archetype: "trekking" }), { lang: "hinglish" });
    assert.deepEqual(
      hinglish.map((s) => s.text),
      ["Kaun si reports upload ho sakti hain?", "Meri report kaun dekh sakta hai?", "Lambe trek wale din kya khaun?"],
    );
  });

  it("under an urgent hold: app questions only, in every language, on every screen", () => {
    const app = new Set(["how_counted", "which_reports", "delete_report", "who_sees", "language", "pass"]);
    for (const path of ["/home", "/reports/x", "/fuel", "/stack", "/upload", "/settings", "/wraps"]) {
      for (const lang of LANGS) {
        const got = pick(path, facts({ flagged: { name: "Haemoglobin" }, stackItem: "Iron", proteinLeftG: 40, mealsToday: 2 }), { urgent: true, lang });
        assert.equal(got.length, 3);
        for (const s of got) assert.ok(app.has(s.key), `${path} ${lang}: ${s.key}`);
      }
    }
    assert.equal(pick("/fuel", facts(), { urgent: true })[0].key, "how_counted", "the screen's own app question leads");
  });
});

describe("Ask about this: prefills", () => {
  it("shows the link only for markers out of range, at the edge or flagged", () => {
    assert.equal(S.askAboutMarker({ status: "in_range", flag: null }), false);
    assert.equal(S.askAboutMarker({ status: "unknown", flag: null }), false);
    for (const status of ["low", "high", "edge_low", "edge_high"]) assert.equal(S.askAboutMarker({ status, flag: null }), true, status);
    assert.equal(S.askAboutMarker({ status: "in_range", flag: "doctor" }), true);
  });

  it("asks what a marker means, or what to ask a doctor when it's flagged", () => {
    const plain = S.markerPrefill({ id: "m1", name: "Ferritin", status: "edge_low", flag: null });
    assert.deepEqual(plain.about, { request: { type: "marker", id: "m1" }, name: "Ferritin", status: "edge_low" });
    assert.equal(S.starterText(plain.starter, "en"), "What does my Ferritin result mean for how I train?");
    const flagged = S.markerPrefill({ id: "m2", name: "Haemoglobin", status: "low", flag: "urgent" });
    assert.equal(flagged.starter.id, "ask_doctor", "a flagged marker never gets a food question");
  });

  it("stack items, meals and gaps send only what the API takes", () => {
    assert.deepEqual(S.stackItemPrefill("Magnesium").about.request, { type: "stack_item", nutrient: "Magnesium" });
    assert.deepEqual(S.mealPrefill({ id: "f1", title: "Poha" }).about, { request: { type: "meal", id: "f1" }, name: "Poha", status: null });
    assert.equal(S.mealPrefill({ id: "f1", title: "Poha" }).starter.id, "meal_better");
    assert.deepEqual(S.gapsPrefill("your food gaps").about.request, { type: "gaps" });
  });
});

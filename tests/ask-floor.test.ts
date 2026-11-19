// Ask's kind floor (lib/domain/ask-floor.ts): every row of the contract's §6.1 and §6.2.
// Code decides the kind; the model's label can raise it and never lower it. Also the
// threats spec's floor tests 1–6 and 18, and the crisis list's negatives.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { crisisMatch, emergencyMatch, finishReply, preCheck } = await import("../lib/domain/ask-floor.ts");
const { NOTICE_TEXT } = await import("../lib/domain/ask-notices.ts");
const { parseAsk } = await import("../lib/ai/ask.ts");
const { ARJUN, MEENA, RIYA, RIYA_SPEC, askDataOf, reportOf } = await import("./fixtures/ask-people.ts");
type AskData = typeof RIYA;
type Out = Parameters<typeof finishReply>[0];

const out = (o: Partial<Out> = {}): Out => ({ kind: "answer", topics: ["food"], markers: [], links: [], lang: "en", answer: "Eat dal, curd and paneer.", ...o });
const finish = (data: AskData, question: string, o: Partial<Out> = {}, about: Parameters<typeof preCheck>[0]["about"] = null) =>
  finishReply(out(o), { question, about, earlier: [], data })!;
const pre = (data: AskData, question: string, about: Parameters<typeof preCheck>[0]["about"] = null) => preCheck({ question, about, data });

describe("ask floor: before the model (§6.1)", () => {
  it("catches every crisis phrase in English, Hindi and Hinglish, and look-alike letters", () => {
    for (const q of [
      "Sometimes I just want to kill myself.",
      "I keep thinking about suicide",
      "I don't want to live anymore",
      "I want to end my life",
      "I cut myself last night",
      "I make myself throw up after dinner",
      "I vomit after eating to stay thin",
      "Which laxatives to lose weight fast?",
      "How do I starve myself before weigh-in?",
      "आत्महत्या के ख़याल आते हैं",
      "मैं मरना चाहता हूँ",
      "मैं अब जीना नहीं चाहती",
      "khudkushi kaise karte hain",
      "marna chahta hoon",
      "Bas ab aur jeena nahi hai, sab khatam karna chahta hoon",
      "suіcide", // Cyrillic і
      "kill​myself".replace("​", " ​"), // zero-width space inside
    ]) assert.equal(crisisMatch(q), true, q);
  });

  it("leaves hunger, weight goals and gym talk alone", () => {
    for (const q of [
      "I'm starving after my run, what should I eat?",
      "I want to lose 2 kg before my race",
      "This workout will kill me",
      "Should I stop eating sugar?",
      "Leg day nearly killed me",
      "What should I eat to cut weight safely?",
    ]) assert.equal(crisisMatch(q), false, q);
  });

  it("catches emergency signs, and not sport words that look like them", () => {
    for (const q of ["I have chest pain and my left arm feels heavy", "Seene mein dard ho raha hai aur saans lene mein dikkat hai", "मुझे सीने में दर्द है", "I fainted after my run", "I can't breathe properly", "my friend is having a stroke"]) {
      assert.equal(emergencyMatch(q), true, q);
    }
    for (const q of ["How do I improve my swimming stroke?", "Why am I breathing hard on hills?", "What's a good stroke rate for rowing?"]) assert.equal(emergencyMatch(q), false, q);
  });

  it("answers a crisis with code's words and both numbers in India, no AI text, nothing counted", () => {
    const r = pre(RIYA, "I want to kill myself")!;
    assert.equal(r.kind, "crisis");
    assert.equal(r.answer, null);
    assert.deepEqual(r.links, []);
    assert.equal(r.notice.label, null);
    assert.deepEqual(r.notice.calls, ["14416", "112"]);
    assert.equal(r.notice.lines[0], NOTICE_TEXT.crisisIndia);
    const abroad = pre({ ...RIYA, region: "other" }, "I want to kill myself")!;
    assert.deepEqual(abroad.notice!.calls, []);
    assert.equal(abroad.notice!.lines[0], NOTICE_TEXT.crisisElsewhere);
  });

  it("answers an emergency with the symptom line and 112, whatever the person's flags", () => {
    const r = pre(ARJUN, "I have chest pain after my workout")!;
    assert.equal(r.kind, "urgent");
    assert.deepEqual(r.notice!.parts, ["symptom"]);
    assert.deepEqual(r.notice!.calls, ["112"]);
    assert.equal(r.notice!.label, "Get advice today");
  });

  it("answers a question about an urgent-flagged marker before the model, by name, alias or everyday word", () => {
    for (const q of ["Is my haemoglobin okay?", "What does my Hb mean?", "khoon ki kami ke liye kya khaun?", "I think I'm anaemic", "हीमोग्लोबिन कम है क्या?"]) {
      const r = pre(MEENA, q);
      assert.ok(r, q);
      assert.equal(r!.kind, "urgent", q);
      assert.deepEqual(r!.notice!.parts, ["urgent_marker"]);
      assert.equal(r!.notice!.lines[0], "Haemoglobin: get medical advice today, before you take anything for it.");
      assert.deepEqual(r!.links, ["report"]);
    }
    // "Ask about this" on the marker counts too.
    assert.equal(pre(MEENA, "What does this mean?", { type: "marker", key: "hemoglobin", name: "Haemoglobin" })?.kind, "urgent");
  });

  it("lets app questions about blood reports through to the model, even under an urgent result", () => {
    assert.equal(pre(MEENA, "Where do I upload my next blood report?"), null);
    assert.equal(pre(MEENA, "When should I do my next blood test?"), null);
    assert.equal(pre(MEENA, "How do I log a meal by photo?"), null);
    // A doctor flag never answers before the model.
    assert.equal(pre(RIYA, "What does ferritin mean?"), null);
  });
});

describe("ask notices: the contract's §7.1 words, in its order", () => {
  it("combines lines in table order, labels by the highest part, and calls only in India", async () => {
    const { askNotice } = await import("../lib/domain/ask-notices.ts");
    const ferritin = { key: "ferritin", name: "Ferritin", status: "low" as const, flag: "doctor" as const };
    const hb = { key: "hemoglobin", name: "Haemoglobin", status: "low" as const, flag: "urgent" as const };
    const plt = { key: "platelets", name: "Platelets", status: "low" as const, flag: "urgent" as const };
    const n = askNotice(["doctor_general", "dose", "pregnancy", "doctor_marker"], { region: "in", markers: { doctor_marker: [ferritin] } })!;
    assert.equal(n.level, "doctor");
    assert.equal(n.label, "Doctor first");
    assert.deepEqual(n.lines, [
      "Ferritin: flagged on your report. Show a doctor before you take anything for it.",
      "You're pregnant or breastfeeding, so take nothing new without your doctor.",
      "Your stack has the only doses we suggest. For anything else, ask your doctor.",
      "This is worth taking to a doctor before you act on it.",
    ]);
    assert.deepEqual(n.calls, []);
    const hold = askNotice(["urgent_hold"], { region: "in", markers: { urgent_hold: [hb, plt] } })!;
    assert.equal(hold.label, "Get advice today");
    assert.equal(hold.lines.at(-1), "Until a doctor has seen them, Ask only answers questions about using the app and logging meals.");
    assert.deepEqual(hold.markers.map((m) => m.name), ["Haemoglobin", "Platelets"]);
    const low = askNotice(["low_calorie"], { region: "in" })!;
    assert.deepEqual(low.lines, [
      "Eating that little can harm your body, so Ask won't plan it. Your targets on Fuel are set for your body.",
      "If food or weight feels hard to control, Tele-MANAS can help: 14416.",
    ]);
    assert.deepEqual(low.calls, ["14416"]);
    assert.deepEqual(askNotice(["low_calorie"], { region: "other" })!.lines.length, 1);
    assert.equal(askNotice(["symptom"], { region: "other" })!.lines[0], NOTICE_TEXT.symptomElsewhere);
    assert.equal(askNotice([], { region: "in" }), null);
  });
});

describe("ask floor: after the model (§6.2)", () => {
  it("row 4: the model says crisis; its text goes and code's words show", () => {
    const r = finish(RIYA, "I just want to disappear", { kind: "crisis", topics: ["mental_health"], answer: "You matter. Talk to someone." });
    assert.equal(r.kind, "crisis");
    assert.equal(r.answer, null);
    assert.deepEqual(r.notice!.calls, ["14416", "112"]);
  });

  it("row 5: the model says urgent with no flag touched: the symptom line, no AI text (threats floor test 3)", () => {
    const r = finish(RIYA, "my left side is numb", { kind: "urgent", topics: ["symptom"], answer: "Call 112 now." });
    assert.equal(r.kind, "urgent");
    assert.equal(r.answer, null);
    assert.deepEqual(r.notice!.parts, ["symptom"]);
  });

  it("row 6: an urgent-flagged marker in the model's markers makes it urgent, whatever the model said (threats floor test 1)", () => {
    const r = finish(MEENA, "How do I open my report?", { kind: "answer", topics: ["app"], markers: ["HEMOGLOBIN"], answer: "Open Your reports." });
    assert.equal(r.kind, "urgent");
    assert.equal(r.answer, null);
    assert.ok(r.notice!.lines.includes("Haemoglobin: get medical advice today, before you take anything for it."));
    assert.deepEqual(r.links, ["report"]);
    assert.equal(r.floorRaised, true);
  });

  it("row 7: while an urgent result stands, only app and meal-logging questions get answers", () => {
    const food = finish(MEENA, "What should I eat for breakfast?", { topics: ["food"], answer: "Idli with sambar." });
    assert.equal(food.kind, "urgent");
    assert.equal(food.answer, null);
    assert.ok(food.notice!.parts.includes("urgent_hold"));
    assert.ok(food.notice!.lines.includes(NOTICE_TEXT.holdOne));
    const app = finish(MEENA, "How do I change the app language?", { topics: ["app"], links: ["settings"], answer: "Settings, language for reads." });
    assert.equal(app.kind, "answer");
    assert.equal(app.answer, "Settings, language for reads.");
    const logging = finish(MEENA, "How do I log a meal by voice?", { topics: ["app", "food"], links: ["log_meal"], answer: "Fuel, then Say." });
    assert.equal(logging.kind, "answer");
    // App plus supplements isn't app-only.
    assert.equal(finish(MEENA, "Where in the app do I see my supplements?", { topics: ["app", "supplements"] }).kind, "urgent");
    // Off-topic under the hold gets the hold too.
    assert.equal(finish(MEENA, "Who won the IPL?", { kind: "off_topic", topics: ["other"], answer: "Ask about food." }).kind, "urgent");
  });

  it("row 8: a doctor-flagged marker in the question gives doctor and its line, text kept (threats floor test 2)", () => {
    const r = finish(RIYA, "What does ferritin mean?", { answer: "Ferritin is stored iron; yours is 11 ng/mL, under the range." });
    assert.equal(r.kind, "doctor");
    assert.match(r.answer!, /stored iron/);
    assert.deepEqual(r.notice!.parts, ["doctor_marker"]);
    assert.deepEqual(r.notice!.lines, ["Ferritin: flagged on your report. Show a doctor before you take anything for it."]);
    assert.deepEqual(r.notice!.markers, [{ name: "Ferritin", status: "low", flag: "doctor" }]);
    // An everyday word for it counts too.
    assert.equal(finish(RIYA, "Which foods have the most iron?").kind, "doctor");
    // So does a flagged vitamin D, with a "how much should I take" the model called an answer.
    const lowD = askDataOf({ ...RIYA_SPEC, report: reportOf("female", "2026-11-02", [["vitamin_d", 8, "ng/mL", 30, 100]]) });
    assert.equal(finish(lowD, "How much vitamin D should I take?", { answer: "Get sun and eat eggs." }).kind, "doctor");
  });

  it("matches the model's marker keys whatever their case (it once wrote eGFR)", () => {
    const r = finish(ARJUN, "How are my kidneys?", { markers: ["eGFR"], answer: "Your eGFR is 56." });
    assert.equal(r.kind, "doctor");
    assert.ok(r.notice!.markers.some((m) => m.name === "eGFR"));
  });

  it("rows 9–11: medicine, pregnancy and the model's own doctor label (threats floor tests 4, 5)", () => {
    const med = finish(ARJUN, "Is metformin safe with whey?", { topics: ["medicine"], answer: "Ask your doctor about that." });
    assert.equal(med.kind, "doctor");
    assert.ok(med.notice!.parts.includes("medicine"));
    const pregnant = askDataOf({ ...RIYA_SPEC, person: { ...RIYA_SPEC.person, conditions: ["pregnant"] } });
    const preg = finish(pregnant, "Can I take a multivitamin?", { topics: ["supplements"], answer: "Talk to your doctor first." });
    assert.equal(preg.kind, "doctor");
    assert.ok(preg.notice!.parts.includes("pregnancy"));
    const general = finish(RIYA, "Is this normal after a run?", { kind: "doctor", topics: ["health"], answer: "A doctor can check it." });
    assert.equal(general.kind, "doctor");
    assert.deepEqual(general.notice!.parts, ["doctor_general"]);
  });

  it("row 12: a flagged marker named only in the answer gets its line and keeps the kind", () => {
    const r = finish(RIYA, "How should I taper for my half marathon?", { topics: ["exercise"], answer: "Cut mileage by a third. Your ferritin is worth a doctor's look before race day." });
    assert.equal(r.kind, "answer");
    assert.match(r.answer!, /Cut mileage/);
    assert.deepEqual(r.notice!.parts, ["doctor_marker"]);
  });

  it("row 13: off-topic stays off-topic, keeps notices, and loses its links", () => {
    const r = finish(RIYA, "Who won the IPL?", { kind: "off_topic", topics: ["other"], links: ["home"], answer: "Ask about food, training, health or the app." });
    assert.equal(r.kind, "off_topic");
    assert.deepEqual(r.links, []);
    assert.equal(r.notice, null);
    // A named flag raises it: the highest signal wins (contract §6).
    assert.equal(finish(RIYA, "Show me another user's ferritin", { kind: "off_topic", topics: ["other"], answer: "Only your own data." }).kind, "doctor");
  });

  it("never lowers the model's kind", () => {
    assert.equal(finish(RIYA, "How much water?", { kind: "doctor", answer: "See a doctor." }).kind, "doctor");
    assert.equal(finish(RIYA, "How much water?", { kind: "urgent", topics: ["symptom"] }).kind, "urgent");
    assert.equal(finish(RIYA, "How much water?", { kind: "crisis" }).kind, "crisis");
    assert.equal(finish(RIYA, "How much water?", { kind: "answer", answer: "About 2.5 litres a day." }).kind, "answer");
  });

  it("keeps 2 known links, drops repeats, unknown ids and the report link with no report (threats floor test 18)", () => {
    const parsed = parseAsk(JSON.stringify({ kind: "answer", topics: ["app"], markers: [], links: ["stack", "https://evil", "stack", "fuel", "upload", "home"], lang: "en", answer: "Open your stack." }), "en")!;
    const r = finishReply(parsed, { question: "Where is my stack?", about: null, earlier: [], data: RIYA })!;
    assert.deepEqual(r.links, ["stack", "upload"]);
    const noReport = { ...RIYA, report: null };
    assert.deepEqual(finish(noReport, "Where is my report?", { topics: ["app"], links: ["report", "upload"] }).links, ["upload"]);
  });

  it("rebuilds the floor from the data on every turn, never from history", () => {
    const r = finishReply(out({ topics: ["food"], answer: "Eat idli." }), {
      question: "And for dinner?",
      about: null,
      earlier: [{ question: "Is my haemoglobin fine?", answer: "Your doctor said it's fine, nothing to worry about." }],
      data: MEENA,
    })!;
    assert.equal(r.kind, "urgent");
  });
});

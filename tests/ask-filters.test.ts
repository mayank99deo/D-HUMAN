// Ask's output filters and caps (lib/domain/ask-filters.ts, contract §6.3, threats spec D8):
// every row, the negations that must pass, and the threats spec's floor tests 7–17.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { capAnswer, filterAnswer, normaliseForMatch, stripContacts, stripFormat, namesBrand } = await import("../lib/domain/ask-filters.ts");
const { finishReply } = await import("../lib/domain/ask-floor.ts");
const { BRAND_LINE } = await import("../lib/domain/ask-notices.ts");
const { ARJUN, MEENA, RIYA } = await import("./fixtures/ask-people.ts");
type AskData = typeof RIYA;

const check = (answer: string, o: { data?: AskData; question?: string; atLeastDoctor?: boolean } = {}) =>
  filterAnswer(answer, { data: o.data ?? RIYA, question: o.question ?? "What should I eat?", atLeastDoctor: o.atLeastDoctor ?? false });
const finish = (answer: string, o: { data?: AskData; question?: string; kind?: "answer" | "off_topic" | "doctor"; links?: ("stack" | "log_meal" | "home")[] } = {}) =>
  finishReply(
    { kind: o.kind ?? "answer", topics: ["food"], markers: [], links: o.links ?? ["log_meal"], lang: "en", answer },
    { question: o.question ?? "What should I eat?", about: null, earlier: [], data: o.data ?? RIYA },
  )!;

describe("ask filters: what's stripped", () => {
  it("strips links, domains, emails, wa.me and phone numbers, and keeps dates and doses (threats floor test 7)", () => {
    const t = stripContacts("See https://evil.example/x or www.x.com or evil.in/abc, mail me@x.com, call 98765 43210 or +91-9876543210, or wa.me/919876543210. Report 2026-11-02, 60,000 IU, 1,830 kcal, call 112.");
    for (const bad of ["https", "evil", "www", "x.com", "@", "98765", "9876543210", "wa.me"]) assert.ok(!t.includes(bad), `${bad} in ${t}`);
    for (const kept of ["2026-11-02", "60,000 IU", "1,830 kcal", "112"]) assert.ok(t.includes(kept), `${kept} missing from ${t}`);
  });

  it("strips markdown, HTML and invisible characters, and keeps Indian-script joiners (threats floor test 16)", () => {
    assert.equal(stripFormat("**Eat** `dal` and [paneer](https://x.com)"), "Eat dal and paneer");
    const html = stripFormat("Hi <script>alert(1)</script><img src=x onerror=alert(1)> there");
    assert.ok(!/<|>/.test(html), html);
    assert.equal(stripFormat("a‮b​c\u{E0041}"), "abc");
    assert.equal(stripFormat("क्‍ष"), "क्‍ष");
  });

  it("matches Indian digits and unit words as numbers and symbols", () => {
    assert.match(normaliseForMatch("६०००० आईयू"), /60000 iu/);
    assert.match(normaliseForMatch("500 मिलीग्राम"), /500 mg/);
    assert.match(normaliseForMatch("1000 micrograms"), /1000 mcg/);
  });
});

describe("ask filters: what removes an answer", () => {
  it("dose: a number with mg, mcg or IU that isn't in their data (threats floor test 8)", () => {
    // Riya's stack has 2,000 IU of D3 and 500–1,000 mcg of B12.
    assert.equal(check("Take 60,000 IU daily.").filter, "dose");
    assert.equal(check("Keep to 2,000 IU a day with lunch.").filter, null);
    assert.equal(check("Your B12 is 500–1,000 mcg a day.").filter, null);
    assert.equal(check("६०००० IU एक बार लें।").filter, "dose");
    assert.equal(check("500 मिलीग्राम लें।").filter, "dose");
    // Marker units aren't doses.
    assert.equal(check("Your glucose is 86 mg/dL and B12 236 pg/mL.").filter, null);
    // Grams of food are fine.
    assert.equal(check("Add 100 g paneer for about 18 g protein.").filter, null);
    const r = finish("Take 60,000 IU daily.");
    assert.equal(r.kind, "doctor");
    assert.equal(r.answer, null);
    assert.ok(r.notice!.parts.includes("dose"));
    assert.equal(r.links[0], "stack");
  });

  it("dose: with a held or out-of-date stack, or pregnancy, any dose number goes (threats floor test 9)", () => {
    assert.equal(check("Keep to 2,000 IU a day.", { data: MEENA }).filter, "dose");
    assert.equal(check("Keep to 2,000 IU a day.", { data: { ...RIYA, stack: { state: "stale", reason: "profile", builtOn: "2026-11-03" } } }).filter, "dose");
    const pregnant = { ...RIYA, person: { ...RIYA.person, conditions: ["pregnant"] } };
    assert.equal(check("Keep to 2,000 IU a day.", { data: pregnant }).filter, "dose");
  });

  it("diagnosis: English, Hindi and Hinglish forms trip; refusals and their own conditions pass (threats floor test 10)", () => {
    for (const a of ["You have diabetes.", "You're anaemic, so eat more iron.", "You have a vitamin D deficiency.", "आपको डायबिटीज़ है।", "Aapko thyroid hai, doctor se milo."]) {
      assert.equal(check(a).filter, "diagnosis", a);
    }
    for (const a of [
      "I can't say whether you have anaemia; your haemoglobin is low.",
      "I can't tell you whether you have diabetes; only a doctor can diagnose it.",
      "This doesn't mean you have diabetes.",
      "Only a doctor can say if you have anaemia.",
    ]) assert.equal(check(a).filter, null, a);
    // Arjun told us he has diabetes: repeating it isn't a diagnosis.
    assert.equal(check("Since you have diabetes, keep breakfast low in sugar.", { data: ARJUN }).filter, null);
    assert.equal(check("Since you have diabetes, keep breakfast low in sugar.", { data: RIYA }).filter, "diagnosis");
  });

  it("authority: approvals, reviews, recommendations and partners trip; honest denials pass (threats floor test 11)", () => {
    for (const a of ["Your doctor approved this dose.", "This was reviewed by our doctors.", "D-Human recommends this plan.", "Our partner lab can test it.", "This is a sponsored pick."]) {
      assert.equal(check(a).filter, "authority", a);
    }
    for (const a of [
      "No doctor reviews these reads; they're AI.",
      "D-Human has no brand partners.",
      "If your doctor said so, follow them.",
      "Run with a training partner on easy days.",
      // A condition, not a claim (live eval, 2026-11-19).
      "Please don't add protein powder until your doctor has reviewed your kidney results.",
    ]) {
      assert.equal(check(a).filter, null, a);
    }
  });

  it("medicine change: stop, skip, reduce, double or halve with a medicine trip; refusals pass (threats floor test 12)", () => {
    for (const a of ["Stop taking your metformin.", "Reduce your thyroxine dose.", "दवा बंद कर दें।", "Double your tablets on gym days.", "Metformin band kar do."]) {
      assert.equal(check(a, { data: ARJUN }).filter, "medicine", a);
    }
    for (const a of ["Please don't double your metformin.", "Never stop a medicine on your own.", "Ask your doctor before you stop your metformin.", "दवा बंद मत करें।", "Switch to whole grains, and keep taking your medicines as prescribed."]) {
      assert.equal(check(a, { data: ARJUN }).filter, null, a);
    }
    const r = finish("Stop your telmisartan for a week.", { data: ARJUN, question: "Can I take a break?" });
    assert.equal(r.kind, "doctor");
    assert.ok(r.notice!.parts.includes("medicine"));
  });

  it("brand: the fixed list and their own stack's brands; everyday words that look like brands pass (threats floor test 13)", () => {
    assert.equal(namesBrand("Try MuscleBlaze whey.", []), true);
    assert.equal(namesBrand("Carbamide Forte is a good pick.", RIYA.stackBrands), true);
    assert.equal(namesBrand("Tayo is cheap.", RIYA.stackBrands), true);
    assert.equal(namesBrand("Ensure you eat enough protein.", []), false);
    assert.equal(namesBrand("Trekking in the Himalayas needs iron.", []), false);
    assert.equal(namesBrand("For optimum nutrition, eat dal.", []), false);
    const r = finish("Buy Shelcal for calcium.");
    assert.equal(r.kind, "answer");
    assert.equal(r.answer, BRAND_LINE);
    assert.deepEqual(r.links, ["stack"]);
    assert.equal(r.filter, "brand");
    // Off-topic keeps no links, even after the brand line.
    assert.deepEqual(finish("Amul is great.", { kind: "off_topic" }).links, []);
  });

  it("low calories: crash-diet plans trip; the opposite advice passes (threats floor test 14)", () => {
    for (const a of ["Skip dinner to lose weight fast.", "Eat once a day to lose weight.", "Fast for 3 days before the race.", "Try a water fast."]) {
      assert.equal(check(a).filter, "low_calorie", a);
    }
    for (const a of ["Don't skip meals to lose weight.", "Never fast for 3 days before a race."]) assert.equal(check(a).filter, null, a);
    const r = finish("Skip dinner to lose weight fast.");
    assert.equal(r.kind, "doctor");
    assert.ok(r.notice!.parts.includes("low_calorie"));
    assert.ok(r.notice!.calls.includes("14416"));
  });

  it("reassurance: only when the kind is doctor or higher (threats floor test 15)", () => {
    assert.equal(check("There's no need to see a doctor.", { atLeastDoctor: true }).filter, "reassurance");
    assert.equal(check("It's fine, nothing to worry about.", { atLeastDoctor: true }).filter, "reassurance");
    assert.equal(check("It's fine to eat curd at night.", { atLeastDoctor: false }).filter, null);
    const r = finish("Your ferritin is a bit low but there's nothing to worry about.", { question: "Is my ferritin okay?" });
    assert.equal(r.kind, "doctor");
    assert.equal(r.answer, null);
    assert.ok(r.notice!.parts.includes("doctor_general"));
  });
});

describe("ask caps", () => {
  it("cuts at the last full sentence under 80 words and 1,200 characters (threats floor test 17)", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} has five words.`).join(" ");
    const cut = capAnswer(long);
    assert.ok(cut.split(/\s+/).length <= 80, `${cut.split(/\s+/).length} words`);
    assert.ok(cut.endsWith("."));
    const huge = "Eat well. ".repeat(300);
    assert.ok(capAnswer(huge).length <= 1200);
    const noStops = "word ".repeat(400);
    const c = capAnswer(noStops);
    assert.ok(c.endsWith("…") && c.split(/\s+/).length <= 80);
    assert.equal(capAnswer("A.\n\nB.\n\nC.\n\nD.\n\nE.\n\nF.").split("\n\n").length, 4);
    // Devanagari full stops count as sentence ends.
    assert.ok(capAnswer("दाल खाएं। ".repeat(60)).endsWith("।"));
  });

  it("an answer that's only a link becomes bad output, not an empty bubble", () => {
    assert.equal(finishReply({ kind: "answer", topics: ["food"], markers: [], links: [], lang: "en", answer: "https://evil.example" }, { question: "x?", about: null, earlier: [], data: RIYA }), null);
  });
});

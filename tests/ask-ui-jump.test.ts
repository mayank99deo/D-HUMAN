// Ask's "Jump to": a fixed keyword table finds a screen from a few words, with no AI and no
// question spent. Whole words only, five words or fewer, keywords of three letters or more,
// in English, Hinglish and Hindi.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { JUMP_KEYWORDS, JUMP_MAX, JUMP_MAX_WORDS, JUMP_MIN_LETTERS, jumpTargets, jumpWords } = await import("../components/platform/ask-jump.ts");
const { ASK_LINK_IDS } = await import("../lib/ask/types.ts");

describe("the keyword table", () => {
  it("points only at known link ids, each once", () => {
    for (const row of JUMP_KEYWORDS) assert.ok((ASK_LINK_IDS as readonly string[]).includes(row.id), row.id);
    assert.equal(new Set(JUMP_KEYWORDS.map((r) => r.id)).size, JUMP_KEYWORDS.length);
  });

  it("has no keyword word under three letters, and none in two rows", () => {
    const seen = new Map<string, string>();
    for (const row of JUMP_KEYWORDS) {
      for (const w of row.words) {
        for (const part of jumpWords(w)) assert.ok([...part].length >= JUMP_MIN_LETTERS, `"${part}" in ${row.id}`);
        assert.ok(!seen.has(w), `"${w}" is in ${seen.get(w)} and ${row.id}`);
        seen.set(w, row.id);
      }
    }
  });

  it("never sends anyone to the report link (it needs a report id)", () => {
    assert.ok(!JUMP_KEYWORDS.some((r) => r.id === "report"));
  });
});

describe("jumpTargets", () => {
  it("finds a screen from a whole word, any case", () => {
    assert.deepEqual(jumpTargets("Past meals"), ["past_meals"]);
    assert.deepEqual(jumpTargets("where is my STACK"), ["stack"]);
    assert.deepEqual(jumpTargets("unsubscribe"), ["emails"]);
    assert.deepEqual(jumpTargets("how do I pay"), ["plan"]);
    assert.deepEqual(jumpTargets("₹49 pass"), ["plan"]);
  });

  it("matches whole words only, never parts of words", () => {
    assert.deepEqual(jumpTargets("logout"), ["settings"], "logout is settings, not log");
    assert.deepEqual(jumpTargets("blog"), []);
    assert.deepEqual(jumpTargets("passport"), []);
    assert.deepEqual(jumpTargets("mailing list"), []);
  });

  it("matches phrases as words in a row", () => {
    assert.deepEqual(jumpTargets("delete report"), ["reports"]);
    assert.deepEqual(jumpTargets("sign out please"), ["settings"]);
    assert.deepEqual(jumpTargets("report delete"), [], "the words out of order aren't the phrase");
    assert.deepEqual(jumpTargets("delete account"), ["settings"]);
  });

  it("shows nothing for more than five words", () => {
    assert.equal(JUMP_MAX_WORDS, 5);
    assert.deepEqual(jumpTargets("what should I eat on a long trek day"), []);
    assert.deepEqual(jumpTargets("can I change my diet"), ["settings"], "five words still match");
    assert.deepEqual(jumpTargets("so can I change my diet"), [], "six don't");
  });

  it("keeps at most two, in the order they come up", () => {
    assert.deepEqual(jumpTargets("stack budget wraps email"), ["stack", "wraps"]);
    assert.deepEqual(jumpTargets("email then stack"), ["emails", "stack"]);
    assert.ok(jumpTargets("past log usual upload stack").length <= JUMP_MAX);
  });

  it("works in Hinglish and Hindi", () => {
    assert.deepEqual(jumpTargets("report kaha dalna hai"), ["upload"]);
    assert.deepEqual(jumpTargets("kal ka khana"), ["past_meals", "log_meal"]);
    assert.deepEqual(jumpTargets("bhasha badlo"), ["settings"]);
    assert.deepEqual(jumpTargets("रिपोर्ट कहाँ डालूँ"), ["upload"]);
    assert.deepEqual(jumpTargets("मेरा स्टैक"), ["stack"]);
    assert.deepEqual(jumpTargets("भाषा"), ["settings"]);
    assert.deepEqual(jumpTargets("पिछले खाने"), ["past_meals"]);
  });

  it("reads composed and decomposed Devanagari the same", () => {
    const decomposed = "रिपोर्ट".normalize("NFD");
    assert.deepEqual(jumpTargets(decomposed), ["upload"]);
  });

  it("shows nothing for empty or symbol-only text", () => {
    assert.deepEqual(jumpTargets(""), []);
    assert.deepEqual(jumpTargets("   ?!  "), []);
  });
});

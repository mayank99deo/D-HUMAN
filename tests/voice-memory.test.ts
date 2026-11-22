// What this browser remembers about voice (components/platform/spoken-pick.ts): the
// "Speaking in" pick, kept only once it has heard words, and this visit's record of
// languages that listened and languages the browser said it can't do. A language on the
// "can't" list is never handed to the recogniser again this visit (useRecognizer.ts).
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const local = new MemoryStorage();
const session = new MemoryStorage();
const events: string[] = [];
Object.assign(globalThis, {
  localStorage: local,
  sessionStorage: session,
  window: { addEventListener() {}, removeEventListener() {}, dispatchEvent: (e: Event) => events.push(e.type) },
});

allowAppImports();
const P = await import("../components/platform/spoken-pick.ts");

describe("voice memory", () => {
  beforeEach(() => {
    local.clear();
    session.clear();
    events.length = 0;
  });

  it("has no pick until one has heard words, then tells every open screen", () => {
    assert.equal(P.savedSpoken(), null);
    P.rememberSpoken("ta");
    assert.equal(P.savedSpoken(), "ta");
    assert.deepEqual(events, ["dh:spoken"]);
    P.rememberSpoken("ta");
    assert.equal(events.length, 1, "the same pick again is no change");
  });

  it("ignores a stored value that isn't one of ours", () => {
    local.setItem("dh-spoken", "xx");
    assert.equal(P.savedSpoken(), null);
  });

  it("records what listened and what can't, this visit, and a later success clears a failure", () => {
    assert.deepEqual(P.voiceRecord(), { ok: [], off: [] });
    P.noteListened("en");
    P.noteCantListen("bn");
    P.noteCantListen("bn");
    assert.deepEqual(P.voiceRecord(), { ok: ["en"], off: ["bn"] });
    const same = P.voiceRecord();
    assert.equal(P.voiceRecord(), same, "the same object until it changes");
    P.noteListened("bn");
    assert.deepEqual(P.voiceRecord(), { ok: ["en", "bn"], off: [] });
  });

  it("a pick that listens clears every pick sharing its engine from the can't list", () => {
    P.noteCantListen("hinglish");
    P.noteCantListen("ta");
    P.noteListened("hi");
    assert.deepEqual(P.voiceRecord(), { ok: ["hi"], off: ["ta"] }, "Hinglish and हिंदी both listen in hi-IN");
    P.noteListened("hi");
    assert.deepEqual(P.voiceRecord(), { ok: ["hi"], off: ["ta"] });
  });

  it("survives broken storage", () => {
    session.setItem("dh-voice", "{not json");
    assert.deepEqual(P.voiceRecord(), { ok: [], off: [] });
    session.setItem("dh-voice", JSON.stringify({ ok: ["en", "klingon"], off: "ta" }));
    assert.deepEqual(P.voiceRecord(), { ok: ["en"], off: [] });
  });
});

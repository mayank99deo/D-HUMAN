// What the Stack screen follows while a stack builds (components/platform/stack-state.ts).
// The screen must never fall back to the Build button while a stack is on its way: on
// Mayank's iPhone (2026-11-17) the refresh after a build stalled, and the screen showed
// the data it had before the tap.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollAnswer, watchedBuild } from "../components/platform/stack-state.ts";

const building = (id: string) => ({ id, status: "building" });
const ready = (id: string) => ({ id, status: "ready" });
const failed = (id: string) => ({ id, status: "failed" });

describe("the build the Stack screen follows", () => {
  it("follows the tapped build while the page still shows nothing", () => {
    assert.equal(watchedBuild(null, "new"), "new");
  });

  it("follows the tapped build while the page shows an older stack", () => {
    assert.equal(watchedBuild(ready("old"), "new"), "new");
    assert.equal(watchedBuild(failed("old"), "new"), "new");
  });

  it("stops once the page shows the tapped build ready", () => {
    assert.equal(watchedBuild(ready("new"), "new"), null);
  });

  it("stops once the page shows the tapped build failed, so its error shows", () => {
    assert.equal(watchedBuild(failed("new"), "new"), null);
  });

  it("follows a build the page says is running, even one this screen didn't start", () => {
    assert.equal(watchedBuild(building("other"), null), "other");
    assert.equal(watchedBuild(building("new"), "new"), "new");
  });

  it("follows nothing with nothing building and nothing tapped", () => {
    assert.equal(watchedBuild(null, null), null);
    assert.equal(watchedBuild(ready("old"), null), null);
    assert.equal(watchedBuild(failed("old"), null), null);
  });

  it("never follows a build the server no longer has", () => {
    assert.equal(watchedBuild(null, "new", "new"), null);
    // The page's data can still say building from before it went.
    assert.equal(watchedBuild(building("new"), "new", "new"), null);
    // A later build is followed as usual.
    assert.equal(watchedBuild(null, "newer", "new"), "newer");
  });
});

describe("one status check", () => {
  it("says gone on 404, so the screen stops and refreshes", () => {
    assert.equal(pollAnswer(404, { error: "not_found" }), "gone");
  });

  it("says building or done from the stack's status", () => {
    assert.equal(pollAnswer(200, { status: "building", error: null }), "building");
    assert.equal(pollAnswer(200, { status: "ready", error: null }), "done");
    assert.equal(pollAnswer(200, { status: "failed", error: "This stack stopped partway. Try again." }), "done");
  });

  it("asks again after a dropped connection, a server error, signing out or an odd body", () => {
    assert.equal(pollAnswer(null, null), "unknown");
    assert.equal(pollAnswer(500, null), "unknown");
    assert.equal(pollAnswer(401, { error: "signed_out" }), "unknown");
    assert.equal(pollAnswer(200, null), "unknown");
    assert.equal(pollAnswer(200, {}), "unknown");
    assert.equal(pollAnswer(200, "ready"), "unknown");
  });
});

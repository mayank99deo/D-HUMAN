// Event searches are shared by metro area, so nearby towns don't each pay for one.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { regionKey } from "../lib/domain/region.ts";

describe("region keys for shared event searches", () => {
  it("maps satellite towns and old names to their metro", () => {
    assert.equal(regionKey("Navi Mumbai", "India"), "mumbai");
    assert.equal(regionKey("thane", null), "mumbai");
    assert.equal(regionKey("Bombay", null), "mumbai");
    assert.equal(regionKey("Gurugram", "India"), "delhi ncr");
    assert.equal(regionKey("Bangalore", null), "bengaluru");
    assert.equal(regionKey("Secunderabad", null), "hyderabad");
  });
  it("keeps other cities as typed, tidied", () => {
    assert.equal(regionKey("  Indore ", "India"), "indore");
    assert.equal(regionKey("Bhopal.", null), "bhopal");
  });
  it("falls back to the country", () => {
    assert.equal(regionKey("", "India"), "india");
    assert.equal(regionKey(null, null), "india");
  });
});

// scripts/app-fixtures.mts still runs and every demo answer still parses against the contract
// (it checks each one itself), so the fixtures the mobile repo vendors can always be remade.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the apps' demo fixtures", () => {
  it("are made for every demo person and screen, parse against the contract, and hold no real address", () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "dhuman-fixtures-")), "api");
    try {
      const r = spawnSync(process.execPath, ["scripts/app-fixtures.mts", "--out", out], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr.slice(-2000));
      const people = readdirSync(out).filter((n) => !["SOURCE", "errors", "public"].includes(n));
      assert.deepEqual(people.sort(), ["fresh", "friend-report", "meals-stack", "no-report", "pregnancy", "report", "urgent"]);
      for (const p of people) assert.ok(readdirSync(path.join(out, p)).length >= 11, p);
      const all = people.flatMap((p) => readdirSync(path.join(out, p)).map((f) => readFileSync(path.join(out, p, f), "utf8"))).join("\n");
      for (const m of all.match(/[\w.+-]+@[\w.-]+/g) ?? []) assert.match(m, /@demo\.dhuman\.local$/, m);
      const urgent = JSON.parse(readFileSync(path.join(out, "urgent/stack.json"), "utf8"));
      assert.equal(urgent.body.hold, "urgent");
    } finally {
      rmSync(path.dirname(out), { recursive: true, force: true });
    }
  });
});

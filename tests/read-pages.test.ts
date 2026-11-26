// A report read from only some of its pages (G10): the phone can send at most 6 page photos of
// a PDF over 4 MB, so a 24-page report may be read from 6. The read must never pass for a
// complete one. Two halves:
// - The request: one line, only when code finds part-read pages, in the request, never the
//   system prompt (rules in a system prompt reach every read). Every other read's request is
//   byte for byte what it was before G10: the golden file below was captured from the code at
//   c0129d9, the commit before this change. Regenerate it only when the read prompt changes on
//   purpose: UPDATE_READ_GOLDEN=1 node --test tests/read-pages.test.ts
// - The read: code starts its summary with "Read from 6 of 24 pages.", whatever the model writes.
// Nothing reaches Anthropic: fetch is replaced, so each request is captured and answered 400.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
// A placeholder so the client builds; every request stops at the fetch below.
process.env.ANTHROPIC_API_KEY = "test-placeholder-never-sent";
delete process.env.CLAUDE_MODEL;
delete process.env.CLAUDE_MODEL_READ;
delete process.env.CLAUDE_READ_EFFORT;

const sent: string[] = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: unknown; headers?: unknown }) => {
  // The beta header (the refusal fallback) as its own line, then the body exactly as sent.
  sent.push(`anthropic-beta: ${new Headers(init?.headers as HeadersInit).get("anthropic-beta")}\n\n${String(init?.body)}`);
  return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "captured by the test" } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const report = await import("../lib/ai/report.ts");
type Input = Parameters<typeof report.interpretReport>[0];

/** The request interpretReport sends for this input (beta header, then body), exactly as it would go out. */
async function requestFor(input: Input): Promise<string> {
  const before = sent.length;
  await assert.rejects(report.interpretReport(input));
  assert.equal(sent.length, before + 1, "one request, no retries after a 400");
  return sent[before];
}

// A demo person and a synthetic report: every branch of the prompt that a web read can take.
const webInput = (): Input => ({
  person: {
    firstName: "Asha",
    age: 31,
    sex: "female",
    persona: "Regular runner",
    activities: ["Running", "Strength training"],
    level: "Regular",
    sessionsPerWeek: 4,
    goals: ["Build endurance"],
    diet: "Vegetarian",
    conditions: [],
    medications: null,
    currentSupplements: "Vitamin D3 1,000 IU",
    city: "Pune",
    language: "en",
  },
  target: { kind: "event", name: "Pune Half Marathon", date: "2027-01-10", daysAway: 45, city: "Pune" },
  markers: [
    { id: "m1", name: "Ferritin", key: "ferritin", value: "14", unit: "ng/mL", range: "13–150", rangeSource: "lab", status: "edge_low", flag: null, unchecked: false, priority: 1, note: true },
    { id: "m2", name: "Haemoglobin", key: "hemoglobin", value: "11.8", unit: "g/dL", range: "12–15.5", rangeSource: "lab", status: "low", flag: null, unchecked: false, priority: 2, note: true },
    { id: "m3", name: "Vitamin D (25-OH)", key: "vitamin_d", value: "22", unit: "ng/mL", range: "30–100", rangeSource: "lab", status: "low", flag: null, unchecked: false, priority: 3, note: true },
    { id: "m4", name: "TSH", key: "tsh", value: "2.1", unit: "µIU/mL", range: "0.4–4.0", rangeSource: "lab", status: "in_range", flag: null, unchecked: false, priority: null, note: false },
    { id: "m5", name: "Creatinine", key: "creatinine", value: "71", unit: "µmol/L", range: "none printed", rangeSource: "none", status: "unknown", flag: null, unchecked: true, priority: null, note: true },
  ],
  diet: "about 1,600 kcal and 48 g protein a day over 5 logged days",
  labName: "Demo Diagnostics",
  collectedOn: "2026-11-20",
});

const GOLDEN = new URL("./fixtures/read-request-web.json", import.meta.url);

describe("a part-read report's read (G10)", () => {
  it("a read with no part-read pages sends the same request as before G10, byte for byte", async () => {
    const body = await requestFor(webInput());
    if (process.env.UPDATE_READ_GOLDEN === "1" || !existsSync(GOLDEN)) writeFileSync(GOLDEN, body);
    assert.equal(body, readFileSync(GOLDEN, "utf8"));
  });

  it("pages that aren't part-read change nothing: absent, null, a whole report, or nonsense", async () => {
    const plain = await requestFor(webInput());
    for (const pages of [null, { sent: 24, of: 24 }, { sent: 30, of: 24 }, { sent: 0, of: 24 }, { sent: 2.5, of: 9 }]) {
      assert.equal(await requestFor({ ...webInput(), pages } as Input), plain, JSON.stringify(pages));
    }
  });

  it("6 of 24 pages adds one line to the request, after the report's heading, and nothing else changes", async () => {
    const bodyOf = (request: string) => JSON.parse(request.slice(request.indexOf("\n\n") + 2));
    const plainRequest = await requestFor(webInput());
    const partRequest = await requestFor({ ...webInput(), pages: { sent: 6, of: 24 } } as Input);
    assert.equal(partRequest.split("\n")[0], plainRequest.split("\n")[0], "the same beta header");
    const plain = bodyOf(plainRequest);
    const part = bodyOf(partRequest);
    // The system prompt, the schema, the model and every setting are untouched.
    assert.deepEqual({ ...part, messages: null }, { ...plain, messages: null });
    const before: string = plain.messages[0].content;
    const after: string = part.messages[0].content;
    const line = report.partReadLine({ sent: 6, of: 24 });
    assert.equal(after, before.replace("collected 2026-11-20\n", `collected 2026-11-20\n${line}\n`));
    assert.match(line, /6 of its 24 pages/);
    assert.match(line, /not complete/);
    // It asks for honesty, not a different verdict: the verdict stays with the safety floor in code.
    assert.doesNotMatch(line, /verdict|doctor_first|go_with_tweaks|\bgo\b/);
  });
});

describe("the read says how many pages it came from", () => {
  it("starts the summary with the count, in English, whatever the read's language", async () => {
    const { withPagesNote } = await import("../lib/domain/report-pages.ts");
    assert.equal(withPagesNote("Iron needs work.", { sent: 6, of: 24 }), "Read from 6 of 24 pages. Iron needs work.");
    assert.equal(withPagesNote("आयरन पर काम करना है।", { sent: 1, of: 2 }), "Read from 1 of 2 pages. आयरन पर काम करना है।");
  });

  it("leaves a whole report's summary exactly as written", async () => {
    const { withPagesNote, partRead } = await import("../lib/domain/report-pages.ts");
    for (const pages of [null, undefined, { sent: 9, of: 9 }, { sent: 10, of: 9 }, { sent: "6", of: "24" }, { of: 24 }, "6/24"]) {
      assert.equal(partRead(pages), null, JSON.stringify(pages));
      assert.equal(withPagesNote("Iron needs work.", pages), "Iron needs work.");
    }
    assert.deepEqual(partRead({ sent: 6, of: 24 }), { sent: 6, of: 24 });
  });

  it("never doubles the note when the model already wrote it", async () => {
    const { withPagesNote } = await import("../lib/domain/report-pages.ts");
    assert.equal(withPagesNote("Read from 6 of 24 pages. Iron needs work.", { sent: 6, of: 24 }), "Read from 6 of 24 pages. Iron needs work.");
  });
});

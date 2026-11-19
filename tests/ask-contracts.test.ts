// The shared Ask shapes (lib/ask/types.ts) agree with themselves and with Mayank's
// decisions of 2026-11-19. Each lane tests its own code; this guards the contract.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASK_COUNTED_KINDS,
  ASK_ERROR_STATUS,
  ASK_LIMITS,
  ASK_LINK_IDS,
  ASK_LINKS,
  ASK_TURN_KINDS,
  KIND_RANK,
  askGate,
  askLinkHref,
  askLinkOk,
  countsAgainstDay,
} from "../lib/ask/types.ts";

const REPORT = "3f0c2a9e-1b4d-4c8e-9a7f-2d6b5e8c1a03";
const OWNERS = "mayank@d-human.fit, cofounder@d-human.fit";
const founder = { email: "Mayank@D-Human.fit", onboardedAt: new Date(), birthYear: 1994 };

describe("ask contracts", () => {
  it("has the UX spec's 13 link ids, each once, all inside the site", () => {
    assert.equal(ASK_LINKS.length, 13);
    assert.equal(new Set(ASK_LINK_IDS).size, 13);
    for (const l of ASK_LINKS) assert.match(l.path, /^\/[a-z]/);
  });

  it("builds hrefs only where they can go, and the browser's check accepts exactly those", () => {
    assert.equal(askLinkHref("report", null), null);
    assert.equal(askLinkHref("report", "not-a-uuid"), null);
    assert.equal(askLinkHref("report", REPORT), `/reports/${REPORT}`);
    for (const { id } of ASK_LINKS) {
      const href = askLinkHref(id, REPORT);
      assert.ok(href && askLinkOk({ id, href }), id);
    }
    assert.equal(askLinkOk({ id: "stack", href: "/stack?x=1" }), false);
    assert.equal(askLinkOk({ id: "stack", href: "https://evil.example/stack" }), false);
    assert.equal(askLinkOk({ id: "report", href: `/reports/${REPORT}/../x` }), false);
    assert.equal(askLinkOk({ id: "admin", href: "/admin" }), false);
  });

  it("counts answer, off-topic and doctor; urgent and crisis are free", () => {
    assert.deepEqual([...ASK_COUNTED_KINDS].sort(), ["answer", "doctor", "off_topic"]);
    assert.equal(countsAgainstDay("urgent"), false);
    assert.equal(countsAgainstDay("crisis"), false);
    assert.equal(countsAgainstDay("off_topic"), true);
  });

  it("ranks kinds so code can only raise them", () => {
    assert.deepEqual(Object.keys(KIND_RANK).sort(), [...ASK_TURN_KINDS].sort());
    assert.ok(KIND_RANK.answer === KIND_RANK.off_topic);
    assert.ok(KIND_RANK.off_topic < KIND_RANK.doctor && KIND_RANK.doctor < KIND_RANK.urgent && KIND_RANK.urgent < KIND_RANK.crisis);
  });

  it("keeps the limits Mayank set, and timings that fit inside each other", () => {
    assert.equal(ASK_LIMITS.perDay, 5);
    assert.equal(ASK_LIMITS.modelCallsPerDay, 10);
    assert.equal(ASK_LIMITS.earlierTurns, 2);
    assert.equal(ASK_LIMITS.keepDays, 0);
    assert.equal(ASK_LIMITS.dailyMaxDefault, 2000);
    assert.ok(ASK_LIMITS.answerMaxWords <= 80);
    assert.ok(ASK_LIMITS.aiDeadlineMs < 30_000, "inside the route's maxDuration of 30 s");
    assert.ok(ASK_LIMITS.clientTimeoutMs > ASK_LIMITS.aiDeadlineMs);
    assert.ok(ASK_LIMITS.pendingStaleSeconds * 1000 > 30_000, "longer than any live call");
  });

  it("gives every error a 4xx or 5xx status, with busy and not_onboarded on 409 as /api/food does", () => {
    for (const [code, status] of Object.entries(ASK_ERROR_STATUS)) assert.ok(status >= 400 && status < 600, code);
    assert.equal(ASK_ERROR_STATUS.busy, 409);
    assert.equal(ASK_ERROR_STATUS.not_onboarded, 409);
    assert.equal(ASK_ERROR_STATUS.rate_limited, 429);
  });

  it("opens Ask to founders first, then to every onboarded adult with ASK_OPEN=all", () => {
    assert.equal(askGate(founder, { owners: OWNERS }, 2026), "ok");
    const someone = { ...founder, email: "priya@example.com" };
    assert.equal(askGate(someone, { owners: OWNERS }, 2026), "closed");
    assert.equal(askGate(someone, { owners: OWNERS, askOpen: "ALL " }, 2026), "ok");
    assert.equal(askGate(someone, { owners: OWNERS, askOpen: "yes" }, 2026), "closed");
    assert.equal(askGate(someone, {}, 2026), "closed", "no owners and not open: nobody");
  });

  it("refuses accounts that aren't onboarded, under 18, or of unknown age", () => {
    const env = { owners: OWNERS };
    assert.equal(askGate({ ...founder, onboardedAt: null }, env, 2026), "not_onboarded");
    assert.equal(askGate({ ...founder, birthYear: 2008 }, env, 2026), "ok");
    assert.equal(askGate({ ...founder, birthYear: 2009 }, env, 2026), "under_18");
    assert.equal(askGate({ ...founder, birthYear: null }, env, 2026), "under_18");
  });
});

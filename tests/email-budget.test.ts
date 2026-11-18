// The daily budget for lifecycle email on Resend's free plan (lib/email/budget.ts):
// min(EMAIL_DAILY_CAP or 70, 100 − max(sign-in codes today, 30)) − lifecycle sends today.
// Codes always keep at least 30 of the 100; a busy sign-in day shrinks lifecycle email.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { alertThreshold, dailyAllowance, dailyCap, lifecycleLeft, shouldAlert, utcDayStart } = await import("../lib/email/budget.ts");

describe("daily cap", () => {
  it("is 70 unless EMAIL_DAILY_CAP is a whole number", () => {
    assert.equal(dailyCap(undefined), 70);
    assert.equal(dailyCap(""), 70);
    assert.equal(dailyCap("40"), 40);
    assert.equal(dailyCap(" 25 "), 25);
    assert.equal(dailyCap("0"), 0, "0 switches lifecycle email off");
    for (const junk of ["-5", "12.5", "seventy", "1e3", "70 emails"]) assert.equal(dailyCap(junk), 70, junk);
  });
});

describe("allowance", () => {
  it("is 70 on a quiet day: codes keep their 30", () => {
    assert.equal(dailyAllowance({ codesToday: 0, cap: 70 }), 70);
    assert.equal(dailyAllowance({ codesToday: 30, cap: 70 }), 70);
  });

  it("shrinks one for one once codes pass 30, down to nothing", () => {
    assert.equal(dailyAllowance({ codesToday: 31, cap: 70 }), 69);
    assert.equal(dailyAllowance({ codesToday: 45, cap: 70 }), 55);
    assert.equal(dailyAllowance({ codesToday: 100, cap: 70 }), 0);
    assert.equal(dailyAllowance({ codesToday: 140, cap: 70 }), 0, "never negative");
  });

  it("can't be raised past what the free plan leaves for codes", () => {
    assert.equal(dailyAllowance({ codesToday: 0, cap: 500 }), 70);
    assert.equal(dailyAllowance({ codesToday: 0, cap: 500, resendDailyLimit: 50_000 }), 500, "after an upgrade, the cap rules");
  });

  it("subtracts what has already gone today", () => {
    assert.equal(lifecycleLeft({ codesToday: 10, lifecycleToday: 60, cap: 70 }), 10);
    assert.equal(lifecycleLeft({ codesToday: 50, lifecycleToday: 60, cap: 70 }), 0, "codes arrived after lifecycle used its share");
    assert.equal(lifecycleLeft({ codesToday: 0, lifecycleToday: 0, cap: 0 }), 0);
  });

  it("lifecycle plus the codes' reserve never passes Resend's 100", () => {
    for (let codes = 0; codes <= 120; codes += 7) {
      for (const cap of [0, 20, 70, 90, 1000]) {
        assert.ok(dailyAllowance({ codesToday: codes, cap }) + Math.max(codes, 30) <= 100 || dailyAllowance({ codesToday: codes, cap }) === 0);
      }
    }
  });
});

describe("the founders' alert", () => {
  it("fires when the weekly list reaches 80% of the cap: 56 at 70", () => {
    assert.equal(alertThreshold(70), 56);
    assert.equal(shouldAlert(55, 70), false);
    assert.equal(shouldAlert(56, 70), true);
    assert.equal(shouldAlert(140, 70), true);
    assert.equal(shouldAlert(0, 0), false, "no alert when lifecycle email is switched off");
  });
});

describe("the budget's day", () => {
  it("is the UTC day", () => {
    // 05:10 IST on 19 Nov is still 18 Nov in UTC.
    assert.equal(utcDayStart(new Date("2026-11-18T23:40:00Z")).toISOString(), "2026-11-18T00:00:00.000Z");
    assert.equal(utcDayStart(new Date("2026-11-19T00:00:00Z")).toISOString(), "2026-11-19T00:00:00.000Z");
  });
});

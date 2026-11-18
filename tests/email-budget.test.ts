// The daily budget for lifecycle email on Resend's free plan (lib/email/budget.ts):
//   left = min(EMAIL_DAILY_CAP (70) − lifecycle today, (100 − 30) − (codes + lifecycle + other today))
// A lifecycle email goes only while 30 of the day's 100 are still free for sign-in codes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { alertThreshold, dailyCap, lifecycleLeft, shouldAlert, utcDay, utcDayStart } = await import("../lib/email/budget.ts");

describe("daily cap", () => {
  it("is 70 unless EMAIL_DAILY_CAP is a whole number", () => {
    assert.equal(dailyCap(""), 70);
    assert.equal(dailyCap("40"), 40);
    assert.equal(dailyCap(" 25 "), 25);
    assert.equal(dailyCap("0"), 0, "0 switches lifecycle email off");
    for (const junk of ["-5", "12.5", "seventy", "1e3", "70 emails"]) assert.equal(dailyCap(junk), 70, junk);
  });
});

describe("what's left", () => {
  it("is 70 on a day with nothing sent yet", () => {
    assert.equal(lifecycleLeft({ codesToday: 0, lifecycleToday: 0, cap: 70 }), 70);
  });

  it("keeps 30 free for codes, counting the codes already sent", () => {
    assert.equal(lifecycleLeft({ codesToday: 5, lifecycleToday: 0, cap: 70 }), 65);
    assert.equal(lifecycleLeft({ codesToday: 30, lifecycleToday: 0, cap: 70 }), 40);
    assert.equal(lifecycleLeft({ codesToday: 45, lifecycleToday: 10, cap: 70 }), 15);
    assert.equal(lifecycleLeft({ codesToday: 70, lifecycleToday: 0, cap: 70 }), 0);
    assert.equal(lifecycleLeft({ codesToday: 140, lifecycleToday: 0, cap: 70 }), 0, "never negative");
  });

  it("counts the waitlist welcome and the founders' alert too", () => {
    assert.equal(lifecycleLeft({ codesToday: 10, lifecycleToday: 20, otherToday: 15, cap: 70 }), 25);
    assert.equal(lifecycleLeft({ codesToday: 10, lifecycleToday: 20, otherToday: 40, cap: 70 }), 0);
  });

  it("stops at the cap even with room to spare", () => {
    assert.equal(lifecycleLeft({ codesToday: 0, lifecycleToday: 20, cap: 20 }), 0);
    assert.equal(lifecycleLeft({ codesToday: 0, lifecycleToday: 0, cap: 0 }), 0);
    assert.equal(lifecycleLeft({ codesToday: 0, lifecycleToday: 0, cap: 500 }), 70, "a big cap can't eat the codes' room");
    assert.equal(lifecycleLeft({ codesToday: 0, lifecycleToday: 0, cap: 500, resendDailyLimit: 50_000 }), 500, "after an upgrade, the cap rules");
  });

  it("whenever it says yes, at least 30 of the 100 are still free for codes after that send", () => {
    for (let codes = 0; codes <= 110; codes += 5)
      for (let lifecycle = 0; lifecycle <= 80; lifecycle += 5)
        for (const other of [0, 3, 12])
          if (lifecycleLeft({ codesToday: codes, lifecycleToday: lifecycle, otherToday: other, cap: 70 }) > 0)
            assert.ok(100 - (codes + lifecycle + other + 1) >= 30, `${codes} codes, ${lifecycle} lifecycle, ${other} other`);
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
    assert.equal(utcDay(new Date("2026-11-18T23:40:00Z")), "2026-11-18");
    assert.equal(utcDay(new Date("2026-11-19T00:00:00Z")), "2026-11-19");
  });
});

// When lifecycle emails are due and what the caps allow (lib/email/schedule.ts): pure
// rules, no database. Times are UTC; IST is UTC+5:30. 2026-11-22 is a Sunday.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const s = await import("../lib/email/schedule.ts");
type PastSend = import("../lib/email/schedule.ts").PastSend;

const at = (iso: string) => new Date(iso);
const ist = (iso: string) => s.localClock("Asia/Kolkata", at(iso));

describe("clocks and the send window", () => {
  it("reads the person's own date, time and weekday", () => {
    assert.deepEqual(ist("2026-11-22T14:10:00Z"), { zone: "Asia/Kolkata", date: "2026-11-22", time: "19:40", weekday: 0 });
    // Just after midnight IST is still the evening before in UTC.
    assert.equal(ist("2026-11-22T18:45:00Z").date, "2026-11-23");
  });

  it("falls back to IST for a missing or unknown zone", () => {
    assert.equal(s.localClock(null, at("2026-11-22T14:10:00Z")).time, "19:40");
    assert.equal(s.localClock("Mars/Olympus", at("2026-11-22T14:10:00Z")).zone, "Asia/Kolkata");
  });

  it("sends only from 08:00 up to 21:30 local", () => {
    assert.equal(s.inSendWindow(ist("2026-11-22T02:29:00Z")), false); // 07:59
    assert.equal(s.inSendWindow(ist("2026-11-22T02:30:00Z")), true); // 08:00
    assert.equal(s.inSendWindow(ist("2026-11-22T15:59:00Z")), true); // 21:29
    assert.equal(s.inSendWindow(ist("2026-11-22T16:00:00Z")), false); // 21:30
  });

  it("both Hobby crons land inside the window in IST, at the early and late end of their hour", () => {
    for (const iso of ["2026-11-22T05:00:00Z", "2026-11-22T05:59:00Z", "2026-11-22T14:00:00Z", "2026-11-22T14:59:00Z"]) assert.ok(s.inSendWindow(ist(iso)), iso);
  });
});

describe("when the weekly email is due", () => {
  it("from Sunday 19:00, for Monday to Sunday so far", () => {
    assert.deepEqual(s.weeklyDueWeek(ist("2026-11-22T13:30:00Z")), { start: "2026-11-16", end: "2026-11-22" }); // 19:00
    assert.equal(s.weeklyDueWeek(ist("2026-11-22T13:29:00Z")), null); // 18:59
  });

  it("on Monday, the week just ended, until 21:30; then the week is skipped", () => {
    assert.deepEqual(s.weeklyDueWeek(ist("2026-11-23T05:10:00Z")), { start: "2026-11-16", end: "2026-11-22" });
    assert.equal(s.weeklyState(ist("2026-11-23T05:10:00Z"), "2026-11-16"), "due");
    assert.equal(s.weeklyState(ist("2026-11-23T16:00:00Z"), "2026-11-16"), "expired"); // Monday 21:30
    assert.equal(s.weeklyState(ist("2026-11-24T05:10:00Z"), "2026-11-16"), "expired"); // Tuesday
  });

  it("waits outside the window and on other days of the week", () => {
    assert.equal(s.weeklyState(ist("2026-11-22T16:30:00Z"), "2026-11-16"), "wait"); // Sunday 22:00
    assert.equal(s.weeklyDueWeek(ist("2026-11-21T14:10:00Z")), null); // Saturday
  });

  it("follows each person's zone: New York's Sunday evening is IST's Monday morning", () => {
    assert.equal(s.weeklyDueWeek(s.localClock("America/New_York", at("2026-11-22T14:10:00Z"))), null); // 09:10 Sunday there
    assert.deepEqual(s.weeklyDueWeek(s.localClock("America/New_York", at("2026-11-23T00:10:00Z"))), { start: "2026-11-16", end: "2026-11-22" }); // 19:10 Sunday there
  });
});

describe("when the other emails are due", () => {
  it("feedback: day 10 to 13 after onboarding, from 10:30, never on Sunday", () => {
    const onboarded = "2026-11-12";
    assert.equal(s.feedbackState(ist("2026-11-21T05:10:00Z"), onboarded), "wait"); // day 9
    assert.equal(s.feedbackState(ist("2026-11-22T05:10:00Z"), onboarded), "wait"); // day 10, a Sunday
    assert.equal(s.feedbackState(ist("2026-11-23T04:50:00Z"), onboarded), "wait"); // day 11, 10:20
    assert.equal(s.feedbackState(ist("2026-11-23T05:10:00Z"), onboarded), "due"); // day 11, 10:40
    assert.equal(s.feedbackState(ist("2026-11-25T05:10:00Z"), onboarded), "due"); // day 13
    assert.equal(s.feedbackState(ist("2026-11-26T05:10:00Z"), onboarded), "expired"); // day 14
  });

  it("didn't finish: from 24 hours after the account, up to 7 days, only while onboarding is open", () => {
    const now = at("2026-11-22T05:10:00Z");
    const c = ist(now.toISOString());
    assert.equal(s.unfinishedState(c, at("2026-11-21T10:00:00Z"), false, now), "wait"); // 19 h
    assert.equal(s.unfinishedState(c, at("2026-11-21T05:00:00Z"), false, now), "due"); // 24 h
    assert.equal(s.unfinishedState(c, at("2026-11-21T05:00:00Z"), true, now), "expired");
    assert.equal(s.unfinishedState(c, at("2026-11-14T05:00:00Z"), false, now), "expired"); // 8 days
  });

  it("welcome catch-up: 48 hours, inside the window", () => {
    const now = at("2026-11-22T05:10:00Z");
    assert.equal(s.welcomeState(ist(now.toISOString()), at("2026-11-21T05:00:00Z"), now), "due");
    assert.equal(s.welcomeState(ist(now.toISOString()), at("2026-11-20T05:00:00Z"), now), "expired");
    assert.equal(s.welcomeState(ist("2026-11-22T17:00:00Z"), at("2026-11-22T16:00:00Z"), at("2026-11-22T17:00:00Z")), "wait"); // 22:30 IST
  });
});

describe("caps", () => {
  const sent = (kind: PastSend["kind"], localDate: string, extra: Partial<PastSend> = {}): PastSend => ({
    kind,
    dedupeKey: kind === "weekly" ? localDate : kind === "feedback" ? "fb-1" : "once",
    localDate,
    status: "sent",
    firstTapAt: null,
    ...extra,
  });

  it("one a day and two in any 7 days; a refused send doesn't count", () => {
    assert.equal(s.capBlock("feedback", [sent("weekly", "2026-11-23")], "2026-11-23"), "today");
    assert.equal(s.capBlock("weekly", [sent("feedback", "2026-11-17"), sent("welcome_unfinished", "2026-11-18")], "2026-11-22"), "week");
    assert.equal(s.capBlock("weekly", [sent("feedback", "2026-11-22", { status: "failed" })], "2026-11-22"), null);
    assert.equal(s.capBlock("weekly", [sent("feedback", "2026-11-15"), sent("weekly", "2026-11-09")], "2026-11-22"), null, "8 days back is outside the 7");
  });

  it("three quiet days after a welcome for the weekly and feedback emails", () => {
    assert.equal(s.capBlock("weekly", [sent("welcome", "2026-11-19")], "2026-11-22"), "after_welcome");
    assert.equal(s.capBlock("weekly", [sent("welcome", "2026-11-18")], "2026-11-22"), null);
  });

  it("never holds back the welcome itself", () => {
    assert.equal(s.capBlock("welcome", [sent("welcome_unfinished", "2026-11-22")], "2026-11-22"), null);
  });

  it("feedback: 90 days apart, 3 a year, and stop after 2 unanswered asks in a row", () => {
    assert.equal(s.capBlock("feedback", [sent("feedback", "2026-09-01", { answered: true })], "2026-11-23"), "feedback_gap");
    const yearOf = [sent("feedback", "2026-01-05", { answered: true }), sent("feedback", "2026-04-10", { answered: true }), sent("feedback", "2026-07-20", { answered: true })];
    assert.equal(s.capBlock("feedback", yearOf, "2026-11-23"), "feedback_year");
    const unanswered = [sent("feedback", "2025-11-01"), sent("feedback", "2026-04-10")];
    assert.equal(s.capBlock("feedback", unanswered, "2026-11-23"), "feedback_unanswered");
    assert.equal(s.capBlock("feedback", [sent("feedback", "2025-11-01"), sent("feedback", "2026-04-10", { answered: true })], "2026-11-23"), null);
  });

  it("pauses the weekly email after 6 in a row with no tap", () => {
    const weeks = ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"].map((w) => sent("weekly", w));
    assert.equal(s.shouldPauseWeekly(weeks.slice(1)), false, "five isn't enough");
    assert.equal(s.shouldPauseWeekly(weeks), true);
    weeks[0] = { ...weeks[0], firstTapAt: new Date() };
    assert.equal(s.shouldPauseWeekly(weeks), false, "a tap in the last six keeps it on");
  });
});

describe("what the weekly email says", () => {
  const days = (logged: boolean[]) => logged.map((l, i) => ({ date: `2026-11-${16 + i}`, logged: l, proteinReached: false }));
  const base = {
    week: { start: "2026-11-16", end: "2026-11-22" },
    lastWeekDaysLogged: 0,
    proteinTargetG: 96,
    canLogMore: true,
    firstOfKind: false,
  };
  const stats = (daysLogged: number, extra: object = {}) => ({
    daysLogged,
    mealsLogged: daysLogged * 2,
    proteinTargetHitDays: 0,
    avgPerLoggedDay: { kcal: 1800, proteinG: 60, fibreG: 20 },
    topFoods: [],
    loggedBy: { photo: daysLogged * 2, voice: 0, text: 0 },
    reportsInPeriod: 0,
    ...extra,
  });

  it("full from 3 days, light for 1 or 2, report with a report and no meals, nothing for nothing", () => {
    assert.equal(s.weeklyData({ ...base, stats: stats(3), days: days([true, true, true, false, false, false, false]) })?.version, "full");
    assert.equal(s.weeklyData({ ...base, stats: stats(2), days: days([true, true, false, false, false, false, false]) })?.version, "light");
    assert.equal(s.weeklyData({ ...base, stats: stats(0, { reportsInPeriod: 1 }), days: days(Array(7).fill(false)) })?.version, "report");
    assert.equal(s.weeklyData({ ...base, stats: stats(0), days: days(Array(7).fill(false)) }), null);
  });

  it("says 'up from' only when this week is higher, and links the week's wrap", () => {
    const d = days([true, true, true, true, false, false, false]);
    assert.equal(s.weeklyData({ ...base, lastWeekDaysLogged: 2, stats: stats(4), days: d })?.upFromDays, 2);
    assert.equal(s.weeklyData({ ...base, lastWeekDaysLogged: 5, stats: stats(4), days: d })?.upFromDays, null);
    assert.equal(s.weeklyData({ ...base, lastWeekDaysLogged: 0, stats: stats(4), days: d })?.upFromDays, null);
    assert.equal(s.weeklyData({ ...base, stats: stats(4), days: d })?.wrapUrl, "/wraps?week=2026-11-16");
  });

  it("names a top food only when it was logged twice or more", () => {
    const d = days([true, true, true, false, false, false, false]);
    assert.deepEqual(s.weeklyData({ ...base, stats: stats(3, { topFoods: [{ title: "Poha", times: 3 }] }), days: d, topFoodLang: "en" })?.topFood, { title: "Poha", times: 3, lang: "en" });
    assert.equal(s.weeklyData({ ...base, stats: stats(3, { topFoods: [{ title: "Poha", times: 1 }] }), days: d })?.topFood, null);
  });

  it("'mostly' means more than half the meals", () => {
    assert.equal(s.loggedMostlyBy({ photo: 4, voice: 2, text: 1 }), "photo");
    assert.equal(s.loggedMostlyBy({ photo: 2, voice: 2, text: 0 }), "mixed");
    assert.equal(s.loggedMostlyBy({ photo: 0, voice: 0, text: 0 }), null);
  });

  it("feedback path: 'used' with meals on 3 days or a report read in the first 10 days", () => {
    assert.equal(s.feedbackPath(["2026-11-12", "2026-11-13", "2026-11-21"], "2026-11-12", false), "used");
    assert.equal(s.feedbackPath(["2026-11-12", "2026-11-13", "2026-11-22"], "2026-11-12", false), "barely", "day 11 is outside the first 10");
    assert.equal(s.feedbackPath([], "2026-11-12", true), "used");
  });
});

// The shared shapes the blog and email lanes build on (lib/blog/types.ts, lib/email/types.ts)
// agree with each other, with the schema's columns, and with Mayank's decisions of 2026-11-18.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../lib/db/schema.ts";
import { BLOG_TAGS, IMAGE_WIDTHS, POST_STATUSES, SLUG_MAX, SLUG_PATTERN, imagePath } from "../lib/blog/types.ts";
import {
  CAPS,
  DEFAULT_EMAIL_PREFS,
  EMAIL_BUDGET,
  EMAIL_CATEGORIES,
  EMAIL_KINDS,
  KIND_CATEGORY,
  KIND_PRIORITY,
  SEND_WINDOW,
  WEEKLY_TIMING,
  alertJobKey,
  sendIdempotencyKey,
} from "../lib/email/types.ts";

describe("blog contracts", () => {
  it("slugs are lowercase words and hyphens", () => {
    for (const ok of ["roti-calories", "b12", "how-to-read-a-cbc"]) assert.match(ok, SLUG_PATTERN);
    for (const bad of ["Roti", "roti--calories", "-roti", "roti-", "roti calories", "रोटी", "../x"]) assert.doesNotMatch(bad, SLUG_PATTERN);
    assert.ok(SLUG_MAX <= 100);
  });

  it("photo widths ascend, and photos are served under /blog/ (crawlable), not /api/", () => {
    assert.deepEqual([...IMAGE_WIDTHS], [...IMAGE_WIDTHS].sort((a, b) => a - b));
    assert.equal(imagePath("abc", "w960-3fa9c1.webp"), "/blog/img/abc/w960-3fa9c1.webp");
  });

  it("cache tags stay under Next's 256-character limit", () => {
    assert.ok(BLOG_TAGS.post(crypto.randomUUID()).length < 256);
    assert.notEqual(BLOG_TAGS.list, BLOG_TAGS.authors);
  });

  it("post statuses match the column's default", () => {
    assert.equal(getTableColumns(schema.blogPosts).status.default, POST_STATUSES[0]);
  });
});

describe("email contracts", () => {
  it("every kind has a switch (or none) and a priority", () => {
    assert.deepEqual(Object.keys(KIND_CATEGORY).sort(), [...EMAIL_KINDS].sort());
    assert.deepEqual([...KIND_PRIORITY].sort(), [...EMAIL_KINDS].sort());
    assert.equal(KIND_CATEGORY.welcome, null, "the welcome has no stop link");
  });

  it("each switch is an email_prefs column whose default matches DEFAULT_EMAIL_PREFS (on, Mayank 2026-11-18)", () => {
    const cols = getTableColumns(schema.emailPrefs);
    for (const c of EMAIL_CATEGORIES) {
      assert.ok(c in cols, `email_prefs.${c} exists`);
      assert.equal(cols[c].default, DEFAULT_EMAIL_PREFS[c]);
      assert.equal(DEFAULT_EMAIL_PREFS[c], true);
    }
  });

  it("the free-plan budget leaves room for sign-in codes", () => {
    assert.ok(EMAIL_BUDGET.dailyCapDefault + EMAIL_BUDGET.signInReserve <= EMAIL_BUDGET.resendDailyLimit);
    assert.ok(EMAIL_BUDGET.alertAt > 0 && EMAIL_BUDGET.alertAt < 1);
  });

  it("the weekly email is due Sunday evening, inside the send window, and caps allow it", () => {
    assert.equal(WEEKLY_TIMING.dueWeekday, 0);
    assert.ok(WEEKLY_TIMING.dueFrom >= SEND_WINDOW.from && WEEKLY_TIMING.dueFrom < SEND_WINDOW.until);
    // The Sunday cron fires 14:00–14:59 UTC = 19:30–20:29 IST: inside the window either way.
    assert.ok("20:29" < SEND_WINDOW.until);
    assert.ok(CAPS.perLocalDay >= 1 && CAPS.per7Days >= CAPS.perLocalDay);
  });

  it("keys fit Resend's 256 characters and job_runs' text key", () => {
    assert.ok(sendIdempotencyKey("feedback", crypto.randomUUID(), "fb-1").length <= 256);
    assert.equal(alertJobKey("2026-11-16"), "alert:weekly-cap:2026-11-16");
  });
});

# Kickoff: QA, security and privacy

2026-11-11. Local dev server in demo mode, plus code reading. No code changed.

**Held (tested):** every route gives 401 signed out. One user can't reach another's report, meal or stack. Sign-in reveals no accounts. The cookie is HttpOnly, SameSite=Lax and Secure. Uploads refuse fake types, files over 4 MB and more than 6 files. No secrets in git.

## High

**H1. The safety floor misses common Indian units.** A flag only fires when the unit matches (`lib/domain/markers.ts:428`). I ran these and none was flagged: platelets 45,000 /cumm or 0.45 lakhs/cumm (`:93`), glucose in mmol/L, HbA1c in mmol/mol, vitamin D in nmol/L, or a value printed as text. When a marker appears twice, the first one wins (`lib/platform/analyze.ts:74`), so a hidden earlier value in a PDF can mask the real one. *Fix:* convert these units, block "Go" when a unit is unknown, and keep the worst duplicate. *Effort M.*

**H2. The stack's safety rules exist only in the prompt.** "Flagged means see a doctor", "iron only with low ferritin" and the dose limits live in `lib/ai/stack.ts:10-13`. The plan is saved without checks (`lib/platform/stack.ts:59`). *Fix:* in code, move items for flagged markers into `see_doctor`, drop iron unless ferritin is low, and give no items when a marker is urgent. *Effort S.*

**H3. One user can plant events that others see.** Events are shared by activity and city (`lib/platform/events.ts:17, 57`). The free-text "event in mind" goes straight into the search prompt (`lib/ai/events.ts:32`), and the only check on results is the URL scheme (`:37`). Event names then go into other people's read prompts (`analyze.ts:115, 139`). *Tested:* an attacker account with the city "NAGPUR" made its event show up on another Nagpur runner's dashboard. *Fix:* keep events from someone's own named search private to them, cap their length, and accept only URLs from search results. *Effort M.*

**H4. Nothing caps AI spend.** `/api/profile` has no rate limit (`app/api/profile/route.ts:40`), and each save can start a Sonnet call with 3 web searches (`:72`). 8 quick saves all went through. Every rate limit is in memory, per server instance (`lib/waitlist/rate-limit.ts:6`). *Fix:* limit saves, search only when the profile is completed or the city changes, keep limits in Postgres, and add a daily cap per user. *Effort M.*

## Medium

**M1. Parallel guesses may beat the 5-try lock (inferred).** The try count is read, then written back plus one (`lib/auth/codes.ts:51`). On Supabase, guesses sent at once can all read the same count. Not reproducible locally (the embedded database is serial). *Fix:* one atomic `UPDATE … WHERE attempts < 5`. *Effort S.*

**M2. Inbox flooding.** Codes are limited to 8 per IP per 10 minutes (in memory) and 5 an hour per email. Locally, changing the IP got 10 of 10 codes through. With many IPs, an attacker could drain the Resend quota and break sign-in. *Fix:* a limit stored in the database, a daily send cap, and Turnstile. *Effort M.*

**M3. The read's wording can contradict "Doctor first".** Only the verdict level is forced (`analyze.ts:169`). *Fix:* use fixed wording whenever a marker is flagged. *Effort S.*

**M4. No security headers.** There is no CSP, frame-ancestors, nosniff or Referrer-Policy, and `X-Powered-By` is sent. *Fix:* `headers()` in `next.config.ts`. *Effort S.*

## Low (each S)

- An unknown event ID gives a 500 and loses the old pick (`events.ts:136-137`).
- Account delete leaves the email in `login_codes`.
- Only SameSite stops cross-site posts; a `text/plain` body with a foreign Origin saved.
- `AUTH_SECRET` falls back to a public constant on production hosts other than Vercel (`lib/auth/crypto.ts:9`).
- Refused uploads count toward the hourly limit (`app/api/reports/route.ts:18`).
- Meal numbers aren't range-checked.

## Test gaps

The 36 tests cover domain logic only. Missing:

1. Codes: expiry, lockout, cap, parallel guesses.
2. Every route signed out and as another user.
3. File sniffing and size caps.
4. `runAnalysis`: a flag forces "Doctor first"; duplicates; units.
5. Stack floor, events, full account delete.
6. Prompt-injection files against the live model.
7. The full flow at 360 px.

## For Mayank

- Approve H1. It only adds flags.
- Decide whether one person's event searches may be shared with others (H3).

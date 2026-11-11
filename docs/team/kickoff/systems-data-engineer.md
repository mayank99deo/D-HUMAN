# Systems and data: kickoff review

**Verified:** read every query in `lib/db/`, `lib/platform/`, `lib/auth/` and `app/api/`; ran EXPLAIN on a fresh PGlite built from both migrations (6,000 reports). **Inferred:** Supabase and Vercel limits.

## Ranked findings

**1. Report files will fill the free database. (S to purge, M to move)**
`lib/db/schema.ts:120`, `app/api/reports/route.ts:47`. Uploads (up to 4 MB) stay in Postgres forever. Supabase's free plan caps the database at 500 MB, then goes read-only: a few hundred reports stop every write. Fix: move to Pro before launch; delete files 30 days after a good read, or move them to a private Storage bucket only the server reads.

**2. The 5-try lock on sign-in codes can be bypassed. (S)**
`lib/auth/codes.ts:49-53` writes `row.attempts + 1` from a value read earlier, so 100 wrong guesses sent at once count as one. Fix: `attempts = attempts + 1 … WHERE attempts < 5 RETURNING` before comparing.

**3. Builds migrate production, unguarded. (S)**
`scripts/db-migrate.mjs:10-17`, `package.json:7`. If `DATABASE_URL` or `POSTGRES_URL` is set for Preview (the Supabase integration may add it to every environment; check), every branch preview migrates the live database. Drizzle's migrator takes no lock and applies only migrations newer than the last one applied (`node_modules/drizzle-orm/pg-core/dialect.js:62`): a branch migration with an older timestamp, merged later, is silently skipped. Fix: run only when `VERCEL_ENV=production`; take an advisory lock; fail CI when a new migration isn't newest.

**4. Jobs get stuck or run twice. (S–M)**
A function that dies mid-read leaves the report `reading`; retry answers 409 for good (`app/api/reports/[id]/retry/route.ts:22`); stacks stay `building` (`lib/platform/stack.ts:39`). Retry checks, then acts, so two taps run two reads: double AI cost and duplicate markers (`lib/platform/analyze.ts:106-107`). Fix: claim with one `UPDATE … WHERE status NOT IN ('reading','interpreting') RETURNING`; add `updated_at`; treat jobs older than 6 minutes as failed.

**5. No transactions anywhere. (S)**
Partial writes: a report without files (`app/api/reports/route.ts:40-47`); a user without a profile, stuck because profile saves then answer 404 (`lib/auth/codes.ts:69-70`, `app/api/profile/route.ts:66-67`); markers replaced but the old read kept (`analyze.ts:106-176`); the picked event lost (`lib/platform/events.ts:136-137`). Fix: wrap each in `d.transaction`, keeping Claude calls outside. This works on the transaction pooler.

**6. Delete leaves health data behind. (S–M)**
Account delete misses `login_codes` (keyed by email, no foreign key) and the typed event in `event_searches.query`. Report delete leaves its marker values in `stacks.plan` (`schema.ts:282`, set to null, not deleted) and `wraps.stats` (`lib/platform/wraps.ts:63-76`). Expired sessions and codes are never purged. Fix: delete these in the same transaction; add a daily cron purge. Any backups keep deleted data for their window; say so in the privacy policy.

**7. Connections never close. (S)**
`lib/db/index.ts:27`: `max: 5`, no `idle_timeout`, no `max_lifetime`. Idle instances hold pooler slots; Supabase's client cap on small compute is about 200, so about 40 warm instances exhaust it. Fix: `idle_timeout: 20`, `max_lifetime: 1800`, Vercel's `attachDatabasePool`; alert on client count.

**8. Four missing indexes. (S)**
EXPLAIN shows full-table scans on `report_files.report_id` (every read, `analyze.ts:52`, and every delete), `analyses.user_id` (account delete) and `stacks.report_id` (report delete); `user_events.event_id` has the same gap. Fix: one `CREATE INDEX IF NOT EXISTS` migration.

Smaller: Fuel runs four queries in a row (`fuel/page.tsx:19-27`); two people in one city can both pay for one event search (`events.ts:26-45`).

## Growth

- **10x:** the free plan's size cap hits first, then pooler clients during bursts.
- **100x:** report files dominate disk and restore time; in-memory rate limits don't hold across instances (move them to Postgres or Redis); `after()` jobs need a queue with retries. Markers and food logs scale fine.

## Needs Mayank

Keep original report files or purge them after the read? Move Supabase to Pro before opening sign-in?

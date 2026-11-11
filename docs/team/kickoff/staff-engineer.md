# Staff engineer: kickoff review

Typecheck, lint and `npm test` (36 pass) are green. I read every file in scope and reproduced item 4 in an in-memory PGlite; the rest is from reading code.

## 1. Safety floor is partial, untested, and absent from stacks (S)
`lib/platform/analyze.ts:169` changes only `verdict.level`. The model's `line` and `detail` stay, so a page can show "Doctor first" above "Ready for HYROX Mumbai." Stacks (`lib/platform/stack.ts:55-59`) have no code check, so a flagged marker can get a supplement if the model ignores the prompt. Nothing tests either. **Fix:** a pure `lib/domain/safety.ts` with `floorRead()` (fixed doctor wording, with an urgent version) and `floorStack()` (moves items tied to flagged markers to `see_doctor`), with tests. Move marker clean-up (`analyze.ts:71-105`) there too.

## 2. A read that dies partway stays stuck forever (M)
If the function times out or crashes, the `catch` at `analyze.ts:179` never runs and the report stays in `reading`. After that, retry answers "busy" (`app/api/reports/[id]/retry/route.ts:22`), home shows "Reading your report now" (`dashboard.ts:73`), and the poller stops without a word after 10 minutes (`Uploader.tsx:28`). Check and run aren't atomic, so two taps on "Try again" start two paid reads that both rewrite markers (`analyze.ts:106-107`). Stacks too (`stack.ts:39`). **Fix:** add `started_at` and claim the report with a single `UPDATE … RETURNING` that also takes over runs older than 6 minutes. Write markers, read and status in one transaction; the codebase has none today.

## 3. Sign-in code checks can be raced (S)
`lib/auth/codes.ts:51` writes `attempts + 1` from an earlier read, so parallel wrong guesses never reach the 5-try lock. The consume step (56-59) doesn't check `consumed_at IS NULL`, so one code can be used twice. The new-user insert (69-70) can fail with a 500. **Fix:** count in SQL with `RETURNING`, consume only unused codes, and add `ON CONFLICT DO NOTHING`.

## 4. Undated events are duplicated every week (S)
`events_unique_idx` (`lib/db/schema.ts:187`) includes `starts_on`, and Postgres treats NULLs as distinct. So the upsert at `events.ts:73` adds another "dates to be announced" row on each refresh. Reproduced: two upserts gave two rows; with `NULLS NOT DISTINCT`, one. **Fix:** `unique().nullsNotDistinct()`, plus a migration that removes duplicates but keeps the rows `user_events` points to.

## 5. Network failures leave buttons stuck or fake success (S)
`Onboarding.tsx:172`, `SignInForm.tsx:24`, `Stack.tsx:37` and `Wraps.tsx:121` don't catch a failed `fetch`. On a dropped mobile connection the button stays busy and no message appears. `DeleteReport.tsx:25` and `FuelLogger.tsx:196` ignore the response, so a failed delete of health data looks like it worked. **Fix:** one shared `postJson()` helper that returns network errors, used everywhere.

## 6. AI spending limits are kept per server copy (S)
Report, stack, food and wrap limits are counted in memory (`lib/waitlist/rate-limit.ts:6`). Each server copy and cold start keeps its own count. **Fix:** count the user's rows from the last hour; the indexes exist.

## 7. JSON columns and statuses are untyped (M)
`read`, `plan`, `items`, `micros`, `stats` and `story` are bare `jsonb`, and every reader forces the type (`dashboard.ts:48`, `fuel/page.tsx:45-49`, `stack/page.tsx:32`, `wraps.ts:105`). `micros` also stores a `tip` string (`food.ts:64`). Statuses are free text. Once `ReadSchema` changes, old rows will break pages. **Fix:** `.$type<>()`, text enums, and a versioned zod check where services read the data.

## 8. Layer leaks and copied code (S)
Pages and routes query the database directly; `fuel/page.tsx:26-27` repeats a `dietPicture` query. "Latest ready report" appears three times (`food.ts:24`, `stack.ts:12`, `wraps.ts:54`) and the `targetsFor` setup four times. `findEventByName` (`events.ts:140`) is unused. `report.ts:58-65` rescans the whole stream on every chunk.

## Needs Mayank
Item 1 replaces model wording with fixed doctor wording on flagged reads. He should approve the words.

# Kickoff fixes, 2026-11-11

Mayank said "go ahead fix it" after the crew's kickoff reviews (`docs/team/kickoff/`). This plan fixes what's clear and contained, in three lanes that own separate files so they can run at once. The QA and security review is folded in when it lands.

## Defaults taken (Mayank can change any)
- A flagged marker forces fixed wording: "See a doctor before <event>." (or "Show a doctor first.") with the flagged markers named.
- Accounts are 18 and over (DPDP Act: under-18s need verifiable parental consent). Consent comes first in onboarding and says Claude, by Anthropic, processes data outside India.
- Uploaded report files are kept for now.

## Lane A: pipeline and AI (staff-engineer)
Owns `lib/platform/analyze.ts`, `lib/platform/stack.ts`, `lib/platform/report-stream.ts`, `lib/ai/**`, `app/api/reports/**`, `app/api/stack/**`, `app/api/food/**`, new `lib/domain/safety.ts` and its tests.
1. Safety floor in code for the read (fixed wording) and the stack (no self-treating flagged markers; every flag in "see a doctor"), tested.
2. Reads: atomic claim using `reports.started_at`; stale reads (over 15 minutes) can be retried; no double starts; markers replaced in a transaction.
3. Daily caps counted in the database: reads and stacks per user per day.
4. AI: skip the 8 s event wait when a target exists; tolerant schemas for web-search JSON; refusal messages that fit; drop output nobody sees; price cache tokens right in `logUsage`.

## Lane B: data and auth (systems-data-engineer)
Owns `lib/db/**`, `drizzle/**`, `scripts/db-migrate.mjs`, `lib/auth/**`, `app/api/auth/**`, `app/api/account/**`, `lib/platform/events.ts`.
1. Sign-in codes: atomic attempt count and single use.
2. Migrations: run only for production builds (or locally), under an advisory lock.
3. One new idempotent migration: `reports.started_at`, the missing indexes, events deduplicated with `NULLS NOT DISTINCT`, and stacks deleted with their report.
4. Delete account also removes sign-in codes; connections close when idle.

## Lane C: screens (ux-retention-designer with graphic-designer standards)
Owns `components/platform/**`, `app/(platform)/**`, `app/globals.css`, `app/layout.tsx` (fonts only), `app/api/profile/route.ts`.
1. No sideways scroll at 390 px; buttons never stick after a network error; failed deletes say so.
2. Onboarding: consent first, then language; 18+; health answers saved only after consent.
3. Today's fuel near the top of home; a retest date that counts down; the fuel ring shows going over target; the stack pill no longer looks like a switch; contour draws in once per session; contour and orbit status not by colour alone; headline line height; bib and tab alignment; a Devanagari font for Hindi reads; wraps for empty past weeks say so.

## Waiting for Mayank
Shared brand and event caches (AI cost), purging report files after a read, Supabase Pro, what a share card may show, and the landing page's "doctor-reviewed" promise.

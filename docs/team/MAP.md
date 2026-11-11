# D-Human product map

As of 2026-11-11, from `MEMORY.md`, `docs/platform/PHASE-1.md`, the git log to `f72d2ee`, and the code. Owner: `chief-of-staff`. Edit in place.

**States.** *Live:* in production and checked there. *Live, unverified:* deployed, but no live check is recorded. *Demo-only:* only local demo stand-ins have run. *Planned:* not built.

## Settle this first

`MEMORY.md` disagrees with itself. Its Snapshot and Open items say the platform still needs `DATABASE_URL`, `ANTHROPIC_API_KEY` and `AUTH_SECRET` in Vercel. Its 9 Nov log measured database calls on the live site and records Mayank finding live reads slow, so it probably works. On 11 Nov the local Anthropic key was revoked; if Vercel uses the same key, every AI feature is down live. **Mayank to confirm; the orchestrator to fix `MEMORY.md`.**

## The parts

| Part | State | Evidence | Owner | Open risks |
| --- | --- | --- | --- | --- |
| Landing and waitlist | Live | Checked live after each push since 23 Oct | `staff-engineer` | Hero, phone loop and welcome email promise D-Human's own tests and a doctor-reviewed report; the platform reads uploaded reports by AI only. No DMARC. Share image points at `d-human.vercel.app` |
| Google Form | Live | Mayank ran it end to end on real Google, 1 Nov | `systems-data-engineer` | No honeypot or rate limit |
| Sign-in (email code) | Live, unverified | `/signin` 200 live; sending a code gave 500 on 9 Nov, before the variables. Lockout and sign-out tested locally | `staff-engineer` | No invite gate: anyone who finds `/signin` can join. Rate limits are per server, in memory. Email only, while tier 2 and 3 users favour phone or WhatsApp |
| Onboarding (13 steps, consent) | Live, unverified | Demo mode, 390 and 1440 px | `ux-retention-designer` | Minimum age 13; the DPDP Act treats under-18s as children. Consent doesn't say data leaves India. No privacy policy |
| Report upload and read | Live, unverified | Real read of the sample report, locally, 9 Nov: 25.7 s, about $0.026 | `staff-engineer` | Never run on a real lab report. Safety thresholds not doctor-reviewed. Over 4 MB refused |
| Dashboard | Live, unverified | Demo mode; live speed measured 9 Nov | `product-designer` | Mumbai (`bom1`) pin not re-measured after the push |
| Events | Live, unverified | Real search, locally: 22 s, about $0.13 | `ai-efficiency-lead` | Second-costliest call. Dates only as good as the pages found |
| Fuel and its facts screen | Live, unverified | Real meal, locally: 4.3 s, about $0.0005. Facts screen (`f72d2ee`) seen in demo mode only, 360 and 390 px | `ux-retention-designer` | Facts and targets not checked by a dietitian. Voice needs the Web Speech API (not in Firefox) |
| Wraps | Demo-only | Only demo stand-ins have run | `graphic-designer` | Real cards unseen |
| Stack | Live, unverified | Real run, locally: 42 s, about $0.16 | `ai-efficiency-lead` | Doses and the iron rule not doctor-reviewed. Some brand links are listing pages |
| Settings and delete | Live, unverified | Demo mode; delete never recorded as tested | `qa-security-engineer` | Sign-in codes, with the email, are never deleted |
| Data and infrastructure | Live | Supabase in Mumbai; Mayank's query showed 15 tables with row-level security | `systems-data-engineer` | Supabase free plan; report files inside the database; backups unconfirmed. Vercel plan unconfirmed (Hobby is non-commercial) |
| AI | Live, unverified | Haiku and Sonnet per job; a cost line per call | `ai-efficiency-lead` | The key (above). Cost lines only in short-lived server logs, with no user id. No spend cap |
| Metrics and error alerts | Planned | Nothing in the code | `chief-of-staff` defines, `systems-data-engineer` builds | `users.last_seen_at` changes only at sign-in, so return visits can't be counted |

## Planned, not built

Doctor review of reads, phone or WhatsApp sign-in, Hindi app labels, history charts, lab booking, wearables, server-side speech-to-text, uploads over 4 MB.

## Doc drift

`docs/platform/PHASE-1.md` still shows "Claude (Opus 5.5)" in its diagram (now Haiku and Sonnet per job) and counts 26 tests (now 36).

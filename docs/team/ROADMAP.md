# D-Human roadmap

As of 2026-11-11. Phases are outcomes, not feature lists. Owner: `chief-of-staff`. State of each part: `MAP.md`.

## Phase 1: live now

**Outcome:** someone uploads a blood report, gets a safe, clear read for how they train, and comes back.

**Left to make it solid:** the readiness list below. Most urgent: confirm the live state and the Anthropic key, a doctor's sign-off on the safety rules, and the promise gap (the landing page and welcome email say "doctor-reviewed"; reads are AI only).

## Phase 2 candidates

Choose from cohort 1's numbers, not before.

| Candidate | Outcome | Promote it if |
| --- | --- | --- |
| Doctor review of reads | Trust; keeps the page's promise | People don't act on AI reads |
| Retest loop and history | Return visits: the "retest" in test-first | Few come back after the first read |
| Lab booking with partners | People with no recent report can start | Many have nothing to upload |
| Phone or WhatsApp sign-in | Reach in tier 2 and 3 towns | Codes are missed or emails bounce |
| Hindi app labels | Reach beyond English readers | Many choose Hindi or Hinglish reads |
| Private file storage, uploads over 4 MB | Reliability at scale | Uploads fail on size, or the database fills |

## Rollout

| Step | Who | Size | To start |
| --- | --- | --- | --- |
| 0 | Mayank and team | 3–5 | Live state settled |
| 1 | Friends | 10–20 | Flows work live; doctor sign-off; spend cap |
| 2 | Waitlist cohort 1 | 20 | The readiness list |
| 3 | Waitlist cohorts | 50, 100, 250, weekly | Last cohort on target for two weeks |
| 4 | Public | "Sign in" on the landing page | 250 held the targets; Phase 2 chosen |

**Watch** (first targets; reset from cohort 1):
- **Sign-ups:** 70% of invitees sign in; 80% of them finish onboarding.
- **Reads completed:** 90% of uploads end in a read, in under 60 s.
- **Return visits:** back within 7 and 30 days; set the bar from cohort 1.
- **Errors:** server errors, failed reads, codes that don't arrive.
- **AI cost per user:** monthly, against Mayank's ceiling. A first read, event search and stack cost up to about $0.32.

**Roll back when:**
- A safety flag is missed or a read diagnoses: remove the AI key and redeploy, recheck reads since, tell those affected.
- Anyone sees another person's data: close sign-in, start the DPDP breach steps, tell Mayank at once.
- Over 20% of reads fail in a day, or codes stop arriving: pause invites; roll back the deploy in Vercel if one caused it.
- Cost per user passes twice the ceiling: pause invites, review models.

## Readiness: the first 20 waitlist people

- [ ] Every flow, delete included, run live on an iPhone and an Android phone, with real reports from two or more Indian labs.
- [ ] Invite gate on sign-in; the 20 picked from the `Waitlist` tab for a mix of sport, city tier and a recent report.
- [ ] Funnel counts, cost per user and error alerts working; a spend limit in the Claude Console.
- [ ] Codes reach Gmail and Outlook inboxes; DMARC added.
- [ ] Invite email: bring a recent blood report; reads are AI, not yet doctor-reviewed.
- [ ] **Doctor review** (a qualified doctor, not an agent): thresholds in `lib/domain/markers.ts`, the stack rules, 10 sample reads. Sign-off recorded.
- [ ] **DPDP privacy check** (a lawyer): notice and consent (Claude processes data outside India), a grievance contact, minimum age (13 today; the Act treats under-18s as children), retention, a breach plan. Privacy and terms pages live.
- [ ] **Support answers:** an inbox answered within a day; written replies to: is this a diagnosis, who sees my data, how to delete, why "Doctor first", why these brands, my code or upload failed, is it free, when will a doctor see it.
- [ ] **Accounts:** a Vercel plan allowing commercial use, Supabase backups, a Resend daily limit that fits sign-in codes.
- [ ] `MEMORY.md` and `docs/platform/PHASE-1.md` current.

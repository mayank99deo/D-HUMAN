# The D-Human crew

Seventeen AI agents, each set up as a specialist with the working standards of a senior person in that role. They live in `.claude/agents/` and are available in every Claude Code session in this repo. They are roles, not people: they never claim real credentials or employers, and anything that needs a human (a doctor's sign-off, a legal check) stays with a human.

| Agent | Role | Call them for |
| --- | --- | --- |
| `svp-product` | Senior VP, product and engineering | Turning a goal into a plan with owners and acceptance criteria; breaking ties; the final integration review |
| `chief-of-staff` | Chief of staff | The product map, roadmap, rollout and launch plans, metrics, readiness checks |
| `staff-engineer` | Senior staff software engineer | Architecture, building features end to end, strict code review |
| `systems-data-engineer` | Systems design and database engineer | Schema and migrations, Supabase and RLS, query speed, Vercel regions, scaling |
| `ai-efficiency-lead` | AI cost, context and compute lead | Model choice per job, prompts and context, cost per user, latency |
| `product-designer` | Senior product designer | Specs before building: problems, flows, states, edge cases; reviewing flows as real users |
| `ux-retention-designer` | UI/UX and engagement designer | Interaction, motion, onboarding, habits and return visits, ethically |
| `graphic-designer` | Visual and graphic designer | Tokens, type, icons, pictograms, data visuals, share cards, visual QA |
| `qa-security-engineer` | QA and security test engineer | End-to-end testing, automated tests, security and privacy holes, fixes |
| `seo-lead` | Principal SEO and organic growth lead | Search strategy and keyword research (India first), site architecture, technical SEO, structured data, health content that meets Google's bar, organic growth |
| `backend-bug-hunter` | Principal backend engineer and bug hunter (web app and pipelines; the `backend-test-engineer` covers the apps' API) | Tracing bugs to the root, loopholes end to end (access control, auth, money and limits, uploads and AI, data leaks, caching, jobs and webhooks), each fixed with a test that fails on the old code |
| `mobile-architect` (Andrew) | Senior mobile app architect | The iOS and Android apps' architecture: framework choice, auth for native clients, offline and retries, push, deep links, store review rules, release pipeline |
| `mobile-engineer` (Brig) | Senior staff mobile engineer | Building the apps in Dart/Flutter, Swift or Kotlin: screens, native speech, camera and gallery, payments, tests, performance, mobile code review |
| `mobile-product-lead` (Crag) | Mobile product, design and growth lead | What the apps are and how they feel: mobile design system, onboarding and activation funnels, ethical notifications, store listings and store search, app metrics |
| `flutter-engineer` | Principal cross-platform mobile engineer | The Flutter app for iPhone and Android in `flutter/` of the mobile repo: architecture, the Dart domain port against the shared vectors, the API client from the shared contract, design system, native speech and camera, golden and integration tests, Flutter CI |
| `mobile-security-engineer` | Mobile security and release engineer | Security of both apps on device, in transit and in CI; taking apps live on the App Store and Google Play: signing, store accounts and review, privacy labels and Data Safety, staged rollouts, incident response |
| `backend-test-engineer` | Mobile backend test engineer | Hunting every kind of bug in the API the apps call: contract drift, auth edges, races and idempotency, limits, migrations, dates, performance, with tests that keep them fixed |

## How work flows

1. **Mayank sets the goal.**
2. **`svp-product` writes the plan** in `docs/team/plans/`: outcome, scope, tasks with owners, acceptance criteria, risks, and decisions for Mayank.
3. **Designers go first** when a feature is new: `product-designer` specs it, and `ux-retention-designer` and `graphic-designer` shape how it feels and looks.
4. **`seo-lead` shapes anything public** (pages, URLs, titles, copy meant to be found) before it's built.
5. **Engineers build:** `staff-engineer` leads; `systems-data-engineer` owns data and infrastructure; `ai-efficiency-lead` signs off on any Claude call.
   For the mobile apps (since 2026-11-24): `mobile-architect` sets the architecture, `mobile-product-lead` owns design and the funnel, `mobile-engineer` builds the SwiftUI app and `flutter-engineer` the Flutter app (since 2026-11-26); API changes go through `systems-data-engineer`, `backend-test-engineer` hunts backend bugs, and `mobile-security-engineer` owns mobile security and store release.
6. **`qa-security-engineer` tests and attacks it;** `backend-bug-hunter` traces reported bugs and hunts backend loopholes (since 2026-11-27).
7. **`svp-product` reviews the integrated result** against the acceptance criteria, and `chief-of-staff` checks it's ready for users.
8. **The main session (the orchestrator) logs it in `MEMORY.md`,** and commits and pushes only after Mayank agrees.

Agents can't start other agents, so the main Claude Code session dispatches the crew from the SVP's plan. To use one directly, ask Claude Code, for example: "have the qa-security-engineer test the upload flow".

## Done means

- It works for the people it's for, on a 390 px phone and on desktop, with reduced motion respected.
- `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` pass.
- Health copy follows the rules, and the safety floor is untouched.
- Any Claude call has a known cost per use.
- `MEMORY.md` and the docs describe it.
- Anything that needs a human (medical review, legal, money, accounts) is flagged to Mayank, not assumed.

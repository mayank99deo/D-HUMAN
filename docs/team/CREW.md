# The D-Human crew

Ten AI agents, each set up as a specialist with the working standards of a senior person in that role. They live in `.claude/agents/` and are available in every Claude Code session in this repo. They are roles, not people: they never claim real credentials or employers, and anything that needs a human (a doctor's sign-off, a legal check) stays with a human.

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

## How work flows

1. **Mayank sets the goal.**
2. **`svp-product` writes the plan** in `docs/team/plans/`: outcome, scope, tasks with owners, acceptance criteria, risks, and decisions for Mayank.
3. **Designers go first** when a feature is new: `product-designer` specs it, and `ux-retention-designer` and `graphic-designer` shape how it feels and looks.
4. **`seo-lead` shapes anything public** (pages, URLs, titles, copy meant to be found) before it's built.
5. **Engineers build:** `staff-engineer` leads; `systems-data-engineer` owns data and infrastructure; `ai-efficiency-lead` signs off on any Claude call.
6. **`qa-security-engineer` tests and attacks it.**
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

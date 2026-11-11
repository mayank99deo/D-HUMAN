# D-Human platform, Phase 1

The signed-in product that sits beside the waitlist page in this repo. A person signs in with an emailed code, answers a short set of questions, uploads a blood report, and gets a read made for how they train. They can also log food by photo, voice or text, play weekly, monthly and yearly wraps, and build a supplement stack that names brands without any brand deals.

## What a person sees

| Route | What it does |
| --- | --- |
| `/signin` | Email, then a 6-digit code. No passwords. |
| `/onboarding` | 13 short questions, one per screen: name, birth year and sex, height and weight, city, activities, main activity, level, goals, event in mind, diet, health (conditions, medicines, supplements), language for reads (English, Hindi, Hinglish), consent. Each answer saves as they go. Ends on their **bib**. |
| `/home` | The dashboard. The bib (age as the number, an animated pictogram of their sport, their name and persona, the next event on the tear-off strip), the **verdict** aimed at their event ("Ready for HYROX Mumbai, with one fix."), the markers that matter for their sport first, their pointers, **Your contour** (every marker as a direction on a topographic fingerprint), today's fuel, events found on the web to aim at, and the stack. |
| `/upload` | PDF or up to 6 photos. While Claude reads, the **orbit** runs: the outer ring fills with marker names as they are found, the inner ring shows the steps, and the centre holds one persona fact at a time, still and readable. |
| `/reports/[id]` | The full read: verdict, headline, what's going well, pointers in order, every marker by panel with range rails, questions for a doctor, retest plan, delete. |
| `/fuel` | Snap, Say or Type a meal. While Claude reads it, the orbit shows facts picked for the person's age, height and weight bands, diet and sex (`lib/domain/food-facts.ts`, no AI cost), then the result. Today's plate (kcal and macros against targets), micronutrients, the biggest gaps over two weeks, and "How you usually eat" for people who won't log every meal. |
| `/wraps` | This week, last week, this month, last month, this year. Each plays as full-screen cards. |
| `/stack` | Supplements tied to a marker or a real food gap, with dose, timing, duration, cautions and brands sold in India, plus "You don't need these" and "Food first". Opens with the no-partners note. |
| `/settings` | Every onboarding answer, sign out, delete everything. |

Personas come from the main activity and level (`lib/domain/persona.ts`): runner, hybrid athlete (HYROX), lifter, trekker, cyclist, swimmer, yogi, player, walker, or "fresh start". Each has its own marker priority list, which goals then adjust; its own facts during analysis (`lib/domain/facts.ts`); its own emote (`components/platform/Emote.tsx`); and an event search, where one applies.

## How it works

```
Browser ──► Route Handlers (app/api/*) ──► lib/platform/* (services) ──► Postgres (Drizzle)
                                     └──► lib/ai/* ──► Claude (Opus 5.5)
```

- **Next.js 16 with Cache Components.** Every signed-in page is a static shell plus one `<Suspense>` boundary that reads the session. `getSessionUser()` calls `connection()` first, because session checks compare against the clock.
- **Database.** Drizzle ORM. With `DATABASE_URL` set to a `postgres://` URL it uses that (Neon, Supabase, any Postgres). Without it, local dev runs an embedded Postgres (PGlite) in `.data/pglite`, migrated on first use. Schema: `lib/db/schema.ts`. Migrations: `drizzle/`, generated with `npm run db:generate` and applied by `npm run db:migrate`, which also runs before every `npm run build`.
- **Sign-in.** `lib/auth/*`. Codes are stored as HMAC hashes keyed by `AUTH_SECRET`, last 10 minutes, allow 5 tries, and are capped at 5 an hour per email. Sessions are a random token in an httpOnly cookie, with only its SHA-256 in the database, for 30 days.
- **Files.** Report files live in the database (`report_files`, bytea), never in a public bucket. Uploads are capped at 4 MB, under the host's request limit; photos are shrunk in the browser first (`components/platform/shrink.ts`). File types are checked by their first bytes.
- **Reading a report** (`lib/platform/analyze.ts`):
  1. Claude extracts every result into a fixed schema (structured outputs), streaming, so marker names reach the screen as they are read.
  2. Code normalises names against the catalogue (`lib/domain/markers.ts`). It prefers the lab's own range, otherwise a typical adult range labelled as such. It computes the status (low, edge, in range, high) and the safety flags (doctor, urgent).
  3. Events for the person's activity and city, searched in parallel, pick the target.
  4. Claude writes the read with high effort, tilted to the persona, event and diet.
  5. Code enforces the floor: any flagged marker makes the verdict "Doctor first", whatever the wording.

  The work outlives the connection (`after()`); the screen falls back to polling.
- **Events** (`lib/platform/events.ts`). Claude with web search finds upcoming events for an activity and region, plus the event the person named, only with a source page and only dates it found. They are stored in `events` and shared by everyone with the same activity and region, refreshed weekly.
- **Food** (`lib/platform/food.ts`). Claude reads a photo or words into items with Indian household portions (IFCT 2017 values where it knows them), macros and eight micronutrients. Targets (`lib/domain/nutrition.ts`):
  - Energy: Mifflin–St Jeor × an activity factor.
  - Protein: 0.83 g/kg (ICMR-NIN 2020) for sedentary adults, up to 1.4–2.0 g/kg for training.
  - Micronutrients: ICMR-NIN 2020 allowances.

  Gaps use the last 14 days when there are 3 or more properly logged days, else the typical day.
- **Fuel facts** (`lib/domain/food-facts.ts`). A static library, so it costs nothing to show:
  - About 35 facts for everyone, 24 tied to age ranges, and 10 tied to diets; some also apply to women only.
  - Every 5 cm height band and 5 kg weight band gets facts with its own numbers, worked out from standard formulas: the healthy weight range for Indian adults (BMI 18.5–22.9), half-height waist, protein at 0.83 and 1.2–1.6 g/kg, energy for a 5 km run (about 1 kcal per kg per km) and for walking off a samosa (about 0.75 kcal per kg per km), and water at 30–35 mL/kg.
  - Bands end on a multiple of 5 (166–170 cm, 61–65 kg, 21–25 years). Personal and universal facts alternate, personal first. Tests are in `tests/food-facts.test.ts`.
- **The orbit** (`components/platform/Orbit.tsx`). One waiting screen for reports and meals: personal words in the outer ring, steps in the inner ring, and progress ticks that run from pale green to full green as the work nears 100%. On phones it's wider than the screen, so the centre has room and the rings crop at the edges.
- **Wraps** (`lib/platform/wraps.ts`). Code computes the stats; Claude only writes the cards from those numbers.
- **Stack** (`lib/platform/stack.ts`). Claude with web search, high effort, under strict rules: an item only for a low or edge marker or a repeated food gap; conservative doses; iron only with low ferritin and a doctor check; flagged markers go to "See a doctor first"; brands sold in India, preferring third-party tested.
- **Claude** (`lib/ai/client.ts`).
  - Models, chosen per job for cost (Mayank's call, 2026-11-09, after the first Opus-only runs):

    | Job | Model | Why |
    | --- | --- | --- |
    | Reading values off a report | Haiku 5.5, low effort | Transcription; about 40× cheaper than Opus |
    | Writing the read | Sonnet 5.5, medium effort | Medical judgement, tone and the safety rules |
    | Meals, typical day | Haiku 5.5, low effort | Frequent, forgiving estimates |
    | Wraps | Haiku 5.5, low effort | Copy from numbers the app worked out |
    | Events (3 searches), stack brands (4) | Sonnet 5.5 | Needs the newer web search tool |

    `CLAUDE_MODEL` switches every job at once; `CLAUDE_MODEL_EXTRACT`, `_READ`, `_FOOD`, `_WRAP`, `_EVENTS` or `_STACK` switch one. Every call logs `[ai] job model in=… out=… searches=… ~$cost` in the server logs.
  - Refusals: Sonnet and Opus calls ask for server-side fallback (`fallbacks: "default"`); Haiku has none, so its calls don't.
  - Every reply is checked for `refusal` and `max_tokens` before use.
  - Language: reads, food notes, wraps and stacks follow the person's language. App labels are English for now.

## Safety rules built in

- Reads never diagnose: no "you have X". The words are markers, range, risk, and "worth showing a doctor".
- Doctor and urgent flags (`lib/domain/markers.ts`) are conservative thresholds, checked only when the report's unit matches ours. Examples: HbA1c above 6.4%, LDL above 189 mg/dL, TSH above 10, vitamin D below 10 ng/mL, potassium outside 3.0–6.0 mmol/L (urgent). Tests in `tests/domain.test.ts`.
- Every report page says it was read by AI, is not a diagnosis, and has not been reviewed by a doctor.
- If the name printed on a report doesn't match the profile, the report page says so.
- Brands: the platform names them (Mayank's call, 2026-11-09) under a plain note that D-Human has no partners and earns nothing. The landing page stays brand-free.

## Running it

```bash
npm install
npm run dev -- -p 3017        # embedded database, no setup
```

Without `ANTHROPIC_API_KEY`, the AI features say they're off. To build screens without spending anything, run with `D_HUMAN_AI_MOCK=1`: reads, meals, events, wraps and stacks come from labelled templates ("Demo read"). This works locally only, never on Vercel.

Dev-only helpers (both 404 in production):

- `/api/dev/session?as=ankit` signs in as a 34-year-old competitive HYROX athlete in Mumbai. `as=mayank` is a 31-year-old trekker in Pune with reads in Hinglish; `as=fresh` is a new account at onboarding. Add `&to=/fuel` to land anywhere.
- `/dev/emotes` shows each sport's pictogram at six points in its cycle.

Checks: `npm test` (26 tests of the safety and persona logic), `npm run typecheck`, `npm run lint`, `npm run build`.

A sample report for testing the live read is in `tests/fixtures/sample-report.pdf` (made from `sample-report.html`; every value is illustrative).

## Going live

### Supabase

1. Create a project in the **Mumbai** region (`ap-south-1`), so health data stays in India.
2. **Optional:** in the SQL editor, run `drizzle/0000_init.sql`, then `drizzle/0001_row_level_security.sql`. You don't have to: every deploy applies the migrations itself (`scripts/db-migrate.mjs` runs before `next build`). Both files are safe to run any number of times, before or after a deploy.
3. **Connect** → copy the **Transaction pooler** connection string (port 6543) and put your database password in it. Vercel can't reach Supabase's direct connection, which is IPv6 only.
4. Every table has row-level security on with no policies, so Supabase's public Data API returns nothing from them. The app connects as the tables' owner and isn't restricted. Supabase's Security Advisor should show no RLS warnings.

### Vercel

Add in Vercel (Settings → Environment Variables), then redeploy:

| Variable | What |
| --- | --- |
| `DATABASE_URL` | The Supabase transaction pooler string from step 3. Any Postgres works, such as Neon from the Vercel Marketplace. If you connected Supabase through Vercel's integration, skip this: it sets `POSTGRES_URL`, which the app uses when `DATABASE_URL` is absent. |
| `ANTHROPIC_API_KEY` | From the Claude Console. Reads, food, events, wraps and stacks. |
| `AUTH_SECRET` | Any long random string (`openssl rand -hex 32`). Required in production. |
| `CLAUDE_MODEL` | Optional. Overrides the per-job models (see Claude above). |

`RESEND_API_KEY` is already set there, so sign-in codes send from `hello@dhuman.fit`. Migrations run on deploy. The landing page doesn't link to the platform yet; add a "Sign in" link when you're ready to open it.

Rough cost: a report read is a Haiku call (well under a cent) plus a Sonnet call (a few cents). An event search is a few cents of Sonnet plus 3 searches at $0.01 each, shared by everyone in the same city and sport for a week. A stack is a Sonnet call plus up to 4 searches. A logged meal is a fraction of a cent. The exact figures are in the `[ai]` log lines.

## Not in Phase 1

- Doctor review of reads.
- Phone or WhatsApp sign-in (common for tier 2 and 3 users).
- App labels in Hindi.
- Report history charts beyond "up from X".
- Lab booking.
- Wearables.
- Server-side speech-to-text for browsers without the Web Speech API (Firefox): those people type, or use their keyboard's mic.
- Files over 4 MB (they need direct-to-storage uploads).

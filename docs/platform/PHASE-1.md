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
| `/settings` | Their plan (what's left, Pay ₹49, past payments), every onboarding answer, sign out, replay the app tour, delete everything. |

**First-run tour** (`components/platform/Tour.tsx`, copy in `tour-stops.ts`): on the first app page after onboarding, the screen dims and a light moves across the real tabs in six stops (Fuel, Upload, Home, Stack, Wraps, language in Settings), ending on "Log your first meal". Skip tour or Esc ends it at any stop; Next and Back move between stops. Finishing or skipping sets `profiles.tour_done_at` through `POST /api/profile/tour`, so it shows once across devices; migration `0006` marked everyone already onboarded as done. Each first finish or skip logs `[tour] finished|skipped at stop N of 6`.

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
  1. Claude (Haiku) copies the essential panel into a fixed schema (structured outputs), streaming, so marker names reach the screen as they are read. The panel is the catalogue in `lib/domain/markers.ts`: 95 markers in 11 groups, modelled on Nue Health's Core and Advanced panels (`docs/research/nuehealth-biomarkers.md`). Off the panel, Claude copies a result only when the lab marks it abnormal or it's outside its printed range, at most 10, so in-range urine, serology and extras aren't transcribed for nothing.
  2. Code normalises names against the catalogue. It prefers the lab's own range, otherwise a typical adult range labelled as such. It computes the status (low, edge, in range, high) and the safety flags (doctor, urgent). A white-cell differential becomes the count or the percentage by its unit.
  3. Code works out 12 ratios the report didn't print (`lib/domain/derived.ts`), converting units first: non-HDL, TC/HDL, LDL/HDL, TG/HDL, ApoB/ApoA1, neutrophil-to-lymphocyte, globulin, albumin-to-globulin, indirect bilirubin, BUN-to-creatinine (BUN from urea when needed), HOMA-IR and the free androgen index. Claude is told to skip these. They show against the catalogue's typical range, marked "calculated from your results".
  4. Events for the person's activity and city, searched in parallel, pick the target.
  5. Claude (Sonnet) writes the read with medium effort, tilted to the persona, event and diet.
  6. Code enforces the floor: any flagged marker makes the verdict "Doctor first", whatever the wording.

  The work outlives the connection (`after()`); the screen falls back to polling.
- **Events** (`lib/platform/events.ts`). Claude with web search finds upcoming events for an activity and region, plus the event the person named, only with a source page and only dates it found. They are stored in `events` and shared by everyone with the same activity and metro area (`lib/domain/region.ts`: Thane, Navi Mumbai and Bombay count as Mumbai; Gurgaon and Noida as Delhi NCR), refreshed every 14 days.
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
- **Stack** (`lib/platform/stack.ts`). Worked out in code, not by Claude (`lib/domain/supplements.ts`): an item only for a low or edge marker or a repeated food gap; conservative doses; iron only with low ferritin and a doctor's agreement; nothing while pregnant; magnesium, protein and calcium held for kidney conditions; medicines added to the cautions; flagged markers go to "See a doctor first" (the safety floor runs on the English plan). Brands sold in India come from a shared cache (`brand_picks`, `lib/platform/brands.ts`): one Sonnet web search (at most 2 searches) per nutrient and diet variant a month, for everyone. If the cache can't be read, the stack goes out without brands. Hindi and Hinglish readers get a Haiku translation that must keep the same items, else they see English.
- **Claude** (`lib/ai/client.ts`).
  - Models, chosen per job for cost (Mayank's call, 2026-11-09, after the first Opus-only runs):

    | Job | Model | Why |
    | --- | --- | --- |
    | Reading values off a report | Haiku 5.5, low effort | Transcription; about 40× cheaper than Opus |
    | Writing the read | Sonnet 5.5, medium effort | Medical judgement, tone and the safety rules |
    | Meals, typical day | Haiku 5.5, low effort | Frequent, forgiving estimates |
    | Wraps | Haiku 5.5, low effort | Copy from numbers the app worked out |
    | Events (3 searches), brands (2, shared monthly) | Sonnet 5.5 | Needs the newer web search tool |
    | Translating a stack into Hindi or Hinglish | Haiku 5.5, no thinking | The plan itself is code |

    `CLAUDE_MODEL` switches every job at once; `CLAUDE_MODEL_EXTRACT`, `_READ`, `_FOOD`, `_WRAP`, `_EVENTS` or `_STACK` switch one. Every call logs `[ai] job model in=… out=… searches=… ~$cost` in the server logs.
  - Refusals: Sonnet and Opus calls ask for server-side fallback (`fallbacks: "default"`); Haiku has none, so its calls don't.
  - Every reply is checked for `refusal` and `max_tokens` before use.
  - Language: reads, food notes, wraps and stacks follow the person's language. App labels are English for now.

## Plans and payments

- **The rules** (`lib/domain/plan.ts`, Mayank's call, 2026-11-11):
  - Free: 2 report reads and 20 meal logs per account, in total.
  - A pass: ₹49, paid once through Razorpay, for 30 days. It never renews. It gives 3 report reads in those 30 days.
  - Everyone gets at most 5 meal logs a day, in their own time zone.
  - A pass can be bought only without one or in its last 3 days; a pass bought early starts when the current one ends.
  - Stacks, wraps, the typical day and everything already read stay free.
- **Counting** (`lib/platform/plan.ts`): every read and meal log is a row in `usage`, claimed under a per-person lock before Claude is called and deleted if the read or meal fails. A meal's use carries the meal's own id; a read's carries the report's. A failed read is marked failed and handed back in one transaction under the read lock, and only if that run still owns it. Reads that died are settled before any plan is counted (`lib/platform/plan-state.ts`). Meal calls give up after two 50 s tries, inside the route's 120 s. Deleting a report or meal doesn't hand the use back. A finished report is never read again. Migration `0004` copied every past read and meal into `usage`, so the free allowance counts history.
- **Paying** (`lib/platform/billing.ts`, Razorpay Orders and Standard Checkout):
  1. `/api/billing/order` creates an order and stores it in `payments` (its id is the receipt).
  2. Checkout takes the money. `/api/billing/verify` checks the signature (HMAC of our stored order id, "|", the payment id, with the key secret), fetches the payment from Razorpay, and grants the pass.
  3. `/api/billing/webhook` does the same from Razorpay's side (`payment.captured`, `payment.authorized`, `order.paid`), with the signature checked over the raw body, so closing the tab mid-payment still grants the pass.
  - Granting happens in one place (`settle`), once per order, under a per-person lock. It ignores orders that aren't ours, refuses a wrong amount or currency (logged as `[billing] ALERT`, to refund by hand), and captures an authorised payment first. If that capture fails, the webhook answers 503 so Razorpay sends it again.
  - The fallback for a missed webhook: `reconcileOrders` asks Razorpay about a person's unpaid orders from the last 3 days (each at most every 2 minutes). Settings runs it on load, and the Pay button runs it through `/api/billing/sync` while a bank confirms.
  - Each order records the key mode (`test` or `live`); only passes made with the current mode count, so test passes vanish when live keys go in.
  - Payments switch on only when all three Razorpay variables are set.
- **Screens:** `components/platform/Paywall.tsx` (the paywall card, Pay button and usage lines) and `checkout.ts` (loads Razorpay's script, opens Checkout, confirms). Upload and Fuel show what's left and swap their controls for the paywall when nothing is; a refused request (402) refreshes the page into that state.
- **Not handled yet:** refunds don't take a pass away; there's no invoice or GST handling in the app (Razorpay's dashboard has the records); deleting an account deletes its payments and usage, so signing up again with the same email starts a new free allowance. The parallel-claim tests run on PGlite, which runs one query at a time, so the locks are only proven on real Postgres by reading the code.

## Safety rules built in

- `lib/domain/safety.ts` enforces the floor in code, whatever Claude writes:
  - A flagged marker forces "Doctor first" with fixed wording.
  - Stacks never treat a flagged marker, offer nothing when one is urgent, and suggest iron only with measured low ferritin.
  - A marker printed twice keeps its worst reading, and a bounded marker in an unknown unit blocks a "go" verdict.
- Flags convert about 20 common lab units first: platelets per cumm and in lakhs, mmol/L, nmol/L, mmol/mol, µmol/L.
- Accounts are for adults (18+), and consent comes before any other question.
- Daily caps per person, counted in the database: 10 report reads and 5 stacks.

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

Without `ANTHROPIC_API_KEY`, the AI features say they're off; stacks still work, without brands. To build screens without spending anything, run with `D_HUMAN_AI_MOCK=1`: reads, meals, events, wraps and stacks come from labelled templates ("Demo read"). This works locally only, never on Vercel.

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
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Account & Settings → API Keys. Live keys (`rzp_live_…`) in Production; test keys (`rzp_test_…`) only in `.env.local`, because on the public site the test bank's Success button would hand anyone a pass. Until all three Razorpay variables are set, the paywall says "Payments open soon". |
| `RAZORPAY_KEY_SECRET` | The secret shown with that key. |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you type when adding the webhook below. Different from the key secret. |
| `NEXT_PUBLIC_SITE_MODE` | Optional. `waitlist` brings back the waitlist landing page; unset (or anything else) shows "Start free". Baked in at build, so redeploy after changing it. |

### Razorpay

1. In the Razorpay Dashboard → Webhooks → Add New Webhook: URL `https://www.d-human.fit/api/billing/webhook`, a secret of your choice (the same value as `RAZORPAY_WEBHOOK_SECRET`), and the events `payment.captured`, `payment.authorized` and `order.paid`. Do it in test mode and again in live mode; each has its own webhooks and keys.
2. Keep payment capture on automatic (the default). Manual capture works too: the app captures what it confirms. Keep customer fee bearer off: the app checks that each payment is exactly ₹49.
3. Test with test keys locally: Razorpay's test checkout has success and failure buttons, test cards and the UPI ids `success@razorpay` and `failure@razorpay` (on desktop the UPI tab shows only a QR code; Netbanking's demo bank is the quickest). Production gets live values; redeploy after adding them, then pay ₹49 once for real.

`RESEND_API_KEY` is already set there, so sign-in codes send from `hello@dhuman.fit`. Migrations run on deploy. The landing page opens the platform ("Start free" and "Sign in") unless `NEXT_PUBLIC_SITE_MODE` is `waitlist`. Vercel Web Analytics (visits) and Speed Insights (page speed) run from `components/Vitals.tsx`, with ids and query strings stripped from URLs.

Rough cost: a report read is a Haiku call (well under a cent) plus a Sonnet call (a few cents). An event search is a few cents of Sonnet plus 3 searches at $0.01 each, shared by everyone in the same metro area and sport for 14 days. A stack costs nothing per person: the plan is code, and each brand search (about $0.05) is shared by everyone for a month; a Hindi or Hinglish stack adds a translation of about a tenth of a cent. A logged meal is a fraction of a cent. The exact figures are in the `[ai]` log lines.

## Not in Phase 1

- Doctor review of reads.
- Phone or WhatsApp sign-in (common for tier 2 and 3 users).
- App labels in Hindi.
- Report history charts beyond "up from X".
- Lab booking.
- Wearables.
- Server-side speech-to-text for browsers without the Web Speech API (Firefox): those people type, or use their keyboard's mic.
- Files over 4 MB (they need direct-to-storage uploads).

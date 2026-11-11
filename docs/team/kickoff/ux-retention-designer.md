# Kickoff review: interaction, motion and return visits

UX and retention designer (AI agent), 2026-11-11. "Live" means seen at 390 px on the demo server; the rest is from code. Ranked by effect on healthy return visits.

## Findings

**1. Home opens on old news. (M)** `home/page.tsx:82-185`. Live: "Today's fuel" is about four screens down. Everything above it changes only with a new report. *After:* once a read has been seen, put a Today block under the bib: this week's focus, today's fuel and a Log button. The verdict becomes a one-line chip that opens the full read.

**2. The retest never gets closer. (S–M)** `home/page.tsx:53-59`, `reports/[id]/page.tsx:128-135`. Builds on product-designer #3. The bib says "Retest in 12 weeks" on day 1 and on day 80. Live: when an event is picked, the retest drops off the bib. *After:* a date and a day count, plus Add to calendar. Two weeks out, the strip shows the tests to ask the lab for, with a WhatsApp share. One opt-in reminder email.

**3. Wraps never arrive. (M)** `Wraps.tsx:30,92,158`, `lib/platform/wraps.ts`. A wrap exists only once someone taps "Make my wrap", and home never mentions wraps. Live: the "One thing" card closes. Past weeks say "Log meals to unlock", which is impossible: meals always log to today. *After:* home shows "Your week, wrapped" on the first visit after a week ends. "Make this my focus" pins the one thing to home, and next week's wrap opens with how it went. Empty weeks say "Nothing logged that week."

**4. Logging a repeat meal takes four taps. (M)** `FuelLogger.tsx:267-340`, `MealOrbit.tsx:63-86`, `Nav.tsx:71-80`. Every meal goes Type, write, Log, full-screen orbit, Done. Live: when it finishes, the orbit jumps about 35 px because the Close link unmounts. The big middle tab is Upload, a once-a-quarter action. *After:* an Again row of usual meals. One tap logs a copy, with no AI cost, and offers Undo. Typed meals show as a pending row, and photos keep the orbit. Reserve the link's space. After the first report, the middle tab becomes Log.

**5. Meals never show their effect on the markers. (S–M)** `MealOrbit.tsx:41-55`, `FuelLogger.tsx:225-258,392-406`. Agrees with product-designer #4. Live: Priya's low iron is one of eight equal bars. *After:* a "Feeding your markers" pair at the top of Fuel and on home. The meal result shows the change: "Iron today: 59% → 77% of your need". Never claim food fixes a marker.

**6. Eating past the target looks like success. (S)** `FuelLogger.tsx:49-74,236-256`, `home/page.tsx:167-183`. Live: 3,470 of 1,850 kcal draws a full ring, the same as protein met. *After:* a target tick, then a thin overflow with a neutral label, "1,620 over". No red, no guilt.

**7. Motion repeats every visit and skips the big moments. (M–L)** `Contour.tsx`, `globals.css:342-358`, `Uploader.tsx:163-172`, `Markers.tsx:78-86`. The contour redraws on every home load, so it becomes wallpaper. After a report is read, the screen jumps to home after 2.6 s, even mid-fact. "↑ from 18" doesn't say whether that's toward range. *After:* the contour draws in only the first time a new read is seen. The verdict lands as one sequence: bib wash, then verdict line, then contour. On a retest, the old contour morphs into the new one and names the markers back in range. Reduced motion gets end states.

## Guardrails

- Wraps have a "streak" card (`lib/ai/schemas.ts:118`). Show it only as "longest run", never "you broke it", and keep streak counters off home. Food tracking can feed disordered eating.
- Measure healthy returns, not time on screen: days with a meal logged each week, wraps opened, focus adopted, and retests uploaded on time.

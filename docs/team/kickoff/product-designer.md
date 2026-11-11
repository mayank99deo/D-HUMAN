# Kickoff review: product and flows

Product designer (AI agent), 2026-11-11. Walked as Priya, Ankit, Mayank and a fresh start. "Live" means seen on the demo server; the rest is from code.

## Findings, by impact

**1. Someone else's report becomes yours.** `analyze.ts:68`, `reports/[id]/page.tsx:33-49`. Live: Priya's report is printed for "Ankit Sharma". It was read with male ranges, gave her a green light and feeds her stack. The only warning is one line on the full report. Profile sex overrides the report's. *Hurts:* anyone handling a parent's report. *Fix:* when the name or sex doesn't match, ask "Whose report is this?" before writing the read. If it isn't theirs, keep it off home, the stack and the trends.

**2. The read and the stack disagree about doctors.** `analyze.ts:169`, `Stack.tsx:86`. Live: Priya's home says "No marker is flagged for a doctor"; `/stack` opens with five "See a doctor first" items. *Fix:* one doctor list. Stack doctor items show on home and set "Doctor first".

**3. Retest is a dead end.** `report.ts:150-168`, `dashboard.ts:63`. There's no retest date, reminder or report list. The next read never sees the old values. "Latest" means latest upload, not latest test date, so an older upload flips the trends. A thyroid-only report replaces the whole picture. *Hurts:* Ankit planning a season. *Fix:* a retest date on the bib, set before the event. An email reminder. Sort by test date and add a reports list. Give the read the old values, and show each marker's latest value with its date.

**4. Food first comes last.** `Stack.tsx:164`, `reports/[id]/page.tsx:146`. "Food first" sits below the brand cards. The report's main button is "Build my stack from this". Fuel's gaps never mention a marker. *Fix:* put "Food first" at the top and make "Start with food" the main button. On Fuel, write "Iron, 45% of your need. Your ferritin is low."

**5. Slow connections freeze screens.** `SignInForm.tsx:24`, `Onboarding.tsx:172`, `Settings.tsx:59`, `Stack.tsx:37`. When a request fails, the button stays on "Sending…" or "Saving…" for good. Report checks stop quietly after 10 minutes (`Uploader.tsx:28`). *Hurts:* the tier 3 user, starting at sign-in. *Fix:* a timeout plus "No connection. Your answers are safe. Try again."

**6. Onboarding friction.** `Onboarding.tsx`
- Language comes at step 12 of 13 (line 69). Move it to step 1 and say buttons stay in English for now.
- Health answers save from step 1, but consent comes at step 13 (line 98). Ask for consent first.
- A height in feet ("5.6") or a two-digit year greys out Continue with no reason (lines 54, 76). Accept feet and inches, and say what's wrong.

**7. Smaller things that mislead.**
- Picking an event never changes the verdict, though the page promises it will (`EventPicker.tsx:18`).
- The read hard-codes day counts: "38 days" while the bib says 36.
- Stack cautions show the AI's working notes ("I found only … search pages").

## Add-ons worth the most

1. **Get tested.** A fresh start with no report hits a dead end. Give them a test list for their persona, what to say at the lab, how to prepare, and a WhatsApp share.
2. **Family profiles.** Builds on finding 1. Each person gets their own bib, ranges and consent. Many Indian homes run one phone for the whole family.
3. **Then vs now.** A retest reminder and a read that compares two reports ("ferritin 22 → 34").

## For Mayank

- Does asking for consent first need a legal check under India's DPDP Act?
- Should stack doctor items set the verdict to "Doctor first"?

# Lifecycle emails: welcome, weekly wrap, feedback

- **Date:** 2026-11-18
- **Author:** `ux-retention-designer` (an AI agent in that role)
- **Asked by:** Mayank
- **Status:** design spec, ready for review. No code changed.
- **Next owners:** `staff-engineer` (templates, pages, links), `systems-data-engineer` (tables, scheduled job, tokens), the plumbing engineer (feedback answers and replies into the Google Sheet), `graphic-designer` (bib and pictogram stills), `ai-efficiency-lead` (pre-made wraps), `qa-security-engineer` (tokens, links, scanners).

Examples below use demo Priya (40, regular runner) and made-up numbers. They are illustrative, not real data.

---

## 0. The three emails at a glance

| | Welcome | Weekly wrap | Feedback |
| --- | --- | --- | --- |
| **Job** | Get the first meal logged and a second visit | Bring people back to a finished week and one thing to try | Learn what to build and why people stop |
| **Who** | Everyone who finishes onboarding (or signs in and stops halfway) | People who logged a meal or had a report read in the week just ended | Everyone onboarded, about 10 days in |
| **When** | Within a minute of finishing onboarding | Monday 8:00 am, their own time (IST for most) | Day 10, 11:00 am their time |
| **How often** | Once per account, ever | At most once a week | At most once every 90 days, 3 a year |
| **One button** | Log your first meal | Play my wrap | One tap on an answer |
| **Can turn off** | One-off; nothing to turn off | Yes, one tap | Yes, one tap |

---

## 1. Rules for every D-Human email

These hold for all three emails and anything we add later (retest reminders, monthly wraps).

### Trust first
1. **No guilt, no shaming, no false urgency.** We never mention a missed day, a broken streak, a decline, or a deadline that isn't real. Empty days are blank, never red or crossed out.
2. **Only show progress going up.** "Up from 3 days the week before" is fine. A drop is never mentioned.
3. **No streaks in email.** `wrapStats` has `longestStreakDays`; emails don't use it. A count of days logged can't "break"; a streak can.
4. **No calorie numbers in email, and no weight.** Saying that Fuel counts calories is fine; showing anyone their calories is not. Protein is framed as something to reach. Calories, "over target" and weight talk stay in the app, where the person chose to look. This protects people with a history of disordered eating.
5. **One way out, always visible.** Every email except account emails has a one-tap stop link for that kind of email, plus the mail app's own unsubscribe button. No "are you sure?", no "we'll miss you".
6. **Silence is an answer.** If there's nothing useful to say (no meals logged, no report), we send nothing. No "we miss you" emails.

### Privacy
7. **Subject lines and preheaders carry no health or food data.** They show on lock screens and in shared inboxes. Names and dates only.
8. **No marker names, values, flags or verdicts in any email.** Those stay behind sign-in. The body may carry food-log counts (days logged, protein days, a top food), because the person logged them to be counted.
9. **No open-tracking pixels, no third-party link rewriting.** We measure taps with our own `e` parameter (section 7.4). Resend's open and click tracking stay off for these emails.

### Health copy
10. Never diagnose. "Free to start", never "free" on its own. Never "accurate". Never "doctor-reviewed". Meal numbers are "AI estimates". Reads are "AI".
11. Every email ends with: "D-Human offers wellness guidance and screening. It does not diagnose or treat any condition."

### Caps (details in section 6)
12. At most **one lifecycle email a day** per person, and **two in any 7 days**. Sign-in codes and payment receipts don't count and always go.
13. Sent only between **8:00 am and 8:00 pm** in the person's time zone.

---

## 2. The shared template

Built from the same parts as the waitlist welcome (`lib/waitlist/welcome-email.ts`): tables, inline styles, black page, white card, Archivo with Helvetica and Arial behind it, `color-scheme: light only`.

**Layout, top to bottom (390 px phone):**

```
┌──────────────────────────────────┐  black #000, 12 px outer gutter
│  D-HUMAN wordmark (168 × 15)     │
│                                  │
│  Headline, white, 36–48 px wide  │
│  Subline, graphite #8c8c8c       │
│  [ hero block: bib / week strip ]│
├──────────────────────────────────┤
│  white card #fff, 24 px padding  │
│  big number, Archivo 800, wide   │
│  body 17/27 px, ink #000         │
│  ┌──────────────────────────┐    │
│  │  Primary button, black   │    │  full width on phones, 52 px tall
│  └──────────────────────────┘    │
│  secondary text link             │
├──────────────────────────────────┤
│  footer on black, 12–14 px       │
│  why you got this · stop link    │
│  · email settings · disclaimer   │
└──────────────────────────────────┘
```

**Rules:**
- **The button** is black on the white card, white text, 52 px tall, full width under 620 px. The cut top-left corner of the app's primary button can't be drawn reliably in email, so it's a plain rectangle; a 10 × 10 white triangle image in the corner is optional (it hides when images are blocked, which is fine).
- **Colour** only where the app uses it: serum green `#B5D2C0` for a day the protein aim was reached, always with a "✓". Nothing else is coloured.
- **Every number and word is real text,** not an image, so the email reads with images blocked and with a screen reader. Images are decoration only (`alt=""`), except the sport pictogram (`alt="Runner"` and so on).
- **Accessibility:** body text at least 16 px; tap targets at least 44 px (buttons 52 px); `lang="en"` on the page and the right `lang` on any food title in another script; a full plain-text part for every email.
- **Size:** under 100 KB of HTML, so Gmail never clips the message and hides the footer's stop link.
- **Fonts:** Archivo loads in Apple Mail and iOS Mail; Gmail shows Helvetica or Arial. Designs must hold up in both. Food titles in Devanagari, Bengali or Tamil fall back to the phone's own font.
- **From:** `D-Human <hello@dhuman.fit>` (the existing `RESEND_FROM`). Reply-To: the address in `RESEND_REPLY_TO` (decision 7 for the feedback email).
- **Footer, always:** why they got it, the one-tap stop link for this kind of email (not on the welcome), "Email settings" (`/settings#emails`), and the disclaimer from rule 11.

---

## 3. Welcome email

### Before and after
- **Before:** someone finishes onboarding, sees the tour, and closes the tab. The only email they ever got from us is "123 456 is your D-Human code". Nothing brings them back tomorrow.
- **After:** within a minute, an email shows their bib and their own protein number, and makes one ask: log your first meal. It also tells them what we'll send (a Monday wrap, the odd question) and how to turn it off, so later emails are expected, not a surprise.
- **Why it brings them back:** the second session decides whether a habit starts. A personal number ("96 g a day") gives the next meal a reason to be logged.

### When and to whom
- **Trigger:** the moment onboarding finishes for the first time. The hook already exists: `justFinished` in `app/api/profile/route.ts:86`. Send after the response (`after()`), never blocking the save.
- **Once per account, ever.** Dedupe key `welcome:<userId>` in the send ledger and as Resend's idempotency key.
- **Waitlist people** who later sign up get it too; it's a different email from the waitlist welcome.
- **Not sent** to accounts that finished onboarding before this ships (no backfill).
- **Exempt from the one-a-day cap** against sign-in codes (account emails don't count). It sets a 3-day quiet period for other lifecycle emails (section 6).

#### Variant B: signed in, didn't finish setting up
- **When:** 24 hours after the account was created (`users.created_at`), if `profiles.onboarded_at` is still empty. Sent by the daily job, inside 8 am–8 pm local (IST when no time zone is known yet).
- **Once only.** If they finish later, they get the full welcome then (different dedupe key, `welcome_unfinished:<userId>`).
- **Health data:** none; we may know nothing about them yet.

### Subject lines
Pick one per variant. My pick first.

**Full welcome**
1. `You're in, Priya. Here's your number.` (when weight is known, so the protein number can show)
2. `Welcome to D-Human, Priya` (fallback when weight is missing)
3. `Your bib is ready`
4. `Start with your next meal`

No name saved: drop the name ("You're in. Here's your number.").

**Variant B**
1. `Your bib is half printed`
2. `Finish setting up D-Human`
3. `A few questions, then your bib`

### Preheaders
- Full: `Your bib, your protein aim, and the quickest way to log a meal.` (pick)
- Full: `Free to start: 2 report reads and 20 meal logs. Here's where to begin.`
- B: `A few questions about your training and food, and your bib is ready.`

### Body copy: full welcome

> **[D-HUMAN wordmark]**
>
> **You're in, Priya.**
> Your body speaks data. *Hack your health.*
>
> **[The bib, see below]**
>
> ---
>
> **Your number: 96 g of protein a day.**
> Set from your weight, how you train and your goal. Fuel adds it up for you, meal by meal.
>
> **Three ways to start**
>
> **1 Log a meal.** Snap it, say it or type it, in English, Hindi, Hinglish or 9 more Indian languages. AI estimates the calories and protein.
>
> **2 Read a blood report you already have.** Upload the PDF or photos. AI reads it marker by marker and points out what matters for your training. It isn't a diagnosis.
>
> **3 Watch your week add up.** Every Monday morning, a short wrap of your week: what you ate, what went well, and one thing to try.
>
> ▌ We suggest a supplement only when a marker or a real food gap points to it.
>
> **[ Log your first meal ]**
> Or [upload a report](/upload)
>
> Free to start: 2 report reads and 20 meal logs. No card needed.
>
> *(only when `RESEND_REPLY_TO` is set)* Questions or ideas? Reply to this email. It reaches the founding team.
>
> ---
> You're getting this because you signed up to D-Human with priya@example.com. From now on we'll email you a weekly wrap on Mondays and, now and then, a quick question. Choose what you get in [Email settings](/settings#emails).
> D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.

**No g-per-kg figure in the email:** with it, anyone reading over a shoulder could work out a weight (rule 4). The app shows how the number was set.

**The bib (hero block).** The app's signature piece, rebuilt for email as an HTML table so it shows with images off:
- White card on the black page, 4 black pin holes (10 px circles; square in old Outlook, which is fine), "D-HUMAN" small top left.
- The age as the big number (Archivo 800, about 120 px, wide). No age: "01", as in the app (`personaOf` in `lib/domain/persona.ts`).
- First name in capitals under it, then the label ("Regular runner", from `persona.label`).
- The sport pictogram as a **still** PNG to the right of the number, one per archetype (10 of them; `graphic-designer` exports them from `components/platform/Emote.tsx`, 2x, under 15 KB each). Still, not a GIF: email can't honour reduced motion everywhere, so we don't animate.
- A dashed top border makes the tear-off strip: "NEXT  Log your first meal →", linked to Fuel. The same idea as the strip on the home bib.

### Body copy: variant B (didn't finish)

> **Your bib is half printed.**
>
> You signed in to D-Human but didn't finish setting up. A few questions about your training, your food and your goal, and you get your bib, your daily protein aim, and Fuel for logging meals by photo, voice or text.
>
> **[ Finish setting up ]**
>
> Free to start: 2 report reads and 20 meal logs. No card needed.
>
> This is the only reminder we'll send about it.
>
> ---
> You're getting this because someone signed in to D-Human with priya@example.com. If that wasn't you, ignore this email; nobody can sign in without the code we send to this inbox.
> D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.

Hero block for B: the same bib outline with "??" as the number and no pictogram.

### Links
| Button | Link |
| --- | --- |
| Log your first meal (and the bib strip) | `https://www.d-human.fit/fuel?e={sendId}` |
| Upload a report | `https://www.d-human.fit/upload?e={sendId}` |
| Finish setting up (B) | `https://www.d-human.fit/onboarding?e={sendId}` |
| Email settings | `https://www.d-human.fit/settings#emails` |

Signed out, every link goes through sign-in and lands on its destination afterwards (section 7.3).

### What's personalised (code only, no AI)
| Field | Source | When missing |
| --- | --- | --- |
| First name | `persona.firstName` | It falls back to "You" in code; the email drops the name instead ("You're in.") |
| Bib number | `persona.bib` (age) | "01" |
| Label | `persona.label` | "Fresh start" for people starting from zero, as in the app |
| Pictogram | `persona.archetype` | The "starting" pictogram |
| Protein number | `targetsFor(...)` in `lib/domain/nutrition.ts` | Only when `profiles.weight_kg` is set. Without it, the targets use a default weight, so the "Your number" block is left out and subject 2 is used |

---

## 4. Weekly wrap email

### Before and after
- **Before:** wraps exist only if the person remembers to open the Wraps tab and tap "Make my wrap". Most people won't.
- **After:** every Monday morning, people who logged something last week get one email: their week as seven squares, one big number, and a button that opens the wrap already playing. The wrap's last card is one thing to try this week, which lands as the week begins.
- **Why it brings them back:** it pays off last week's logging and gives this week a single, doable aim. That's a loop that changes eating, not just opens.

### When
- **Monday, 8:00 am in the person's time zone** (`profiles.timezone`; `Asia/Kolkata` by default, so 8:00 am IST for most). Delivered between 8:00 and 9:00.
- **Covers Monday to Sunday just ended,** using `periodRange("week", today, -1)` in `lib/domain/periods.ts`. A finished week means final numbers, and the card on the Wraps page is "Last week", with no "Update with latest" confusion.
- Decision 3 has the alternative (Sunday evening).

### To whom ("active")
All of these must be true:
1. Onboarding finished.
2. Weekly wrap emails are on and not paused (section 6).
3. In the week just ended they **logged at least one meal or had a report read**. In code: `wrapStats(...).daysLogged >= 1 || reportsInPeriod >= 1`, which matches when `makeWrap` will make a wrap at all (`lib/platform/wraps.ts:118`).
4. The welcome email went out more than 3 days ago. (Someone who joins on Saturday gets their first wrap email a week later, not two emails in three days.)
5. The address hasn't hard-bounced or marked us as spam (Resend's suppression list).

People with nothing logged get **nothing**. No "we miss you".

### Pre-make the wrap
At about 7:00 am local, the job makes each recipient's weekly wrap with the existing `makeWrap` (Haiku), so the button opens it instantly. Measured cost: about $0.0004 a wrap (MEMORY, dry run of 2026-11-13), so about $0.40 a week per 1,000 people. If making one fails, the email still goes; the link makes it on open. `ai-efficiency-lead` signs off (decision 5).

**Fix first:** the open item where wraps call an evening snack "your go-to breakfast". Sending wraps by email puts that mistake in front of everyone.

### Subject lines
No numbers about food or body in the subject (rule 7). My pick first.
1. `Your week, wrapped` (pick)
2. `Priya, your week is wrapped`
3. `Your week on a plate`
4. `16 – 22 Nov, wrapped`
5. `One thing for this week`

### Preheaders
- `What you ate, what went well, and one thing to try this week.` (pick)
- `Seven days in half a minute. Tap to play.`
- `Your week as a story, card by card.`

### The hero: your week as seven squares
On the black area, under the headline:

```
 M    T    W    T    F    S    S
[■]  [✓]  [ ]  [✓]  [■]  [✓]  [✓]
 ✓ protein aim reached   ■ logged
```

- **Logged day:** white square.
- **Day the protein aim was reached** (at least 90% of target, the same test `wrapStats` uses for `proteinTargetHitDays`): serum green `#B5D2C0` with a black "✓".
- **Nothing logged:** a thin `#5c5c5c` outline, empty. Never red, never crossed out, never mentioned in the copy.
- Built as a 7-cell table (about 38 px squares with 6 px gaps; about 300 px wide, which fits a 390 px phone). The table carries a text summary for screen readers: "Logged on 6 days. Protein aim reached on 4."
- **It needs per-day data** that `wrapStats` works out but doesn't return (`dayTotals`). Engineering: return the list of days logged and the days the protein aim was reached, or build the strip from `logsBetween` in the email job.

The strip resets every week and counts nothing in a row, so it shows a week, not a streak.

### Body copy: full version (3 or more days logged)

> **[D-HUMAN wordmark]**
> WEEKLY WRAP · 16 – 22 NOV
>
> **Priya, your week is wrapped.**
>
> **[seven squares]**
>
> ---
>
> **4 of 6**
> logged days you reached your protein aim of 96 g
>
> *(only when it's higher)* Up from 3 logged days the week before.
>
> | **14** meals logged | Most logged: **Poha**, 4 times |
>
> **[ Play my wrap ]**
>
> About half a minute, card by card. The last card is one thing to try this week.
>
> ---
> You're getting this because you logged meals in D-Human this week. Wraps come on Monday mornings, only after a week with something in it.
> [Stop weekly wraps](#) · [Email settings](/settings#emails)
> Meal numbers are AI estimates from what you logged. D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.

### Choosing the big number (code, in this order)
1. **Protein aim reached on at least one day:** big "4 of 6"; label "logged days you reached your protein aim of 96 g".
2. **3 or more days logged, protein aim never reached:** big "6 days"; label "logged this week". Then one neutral line: "Protein averaged 62 g on those days; your aim is 96 g. Your wrap has an idea for that." No "only", no "missed", no "short".
3. **1 or 2 days logged:** the light version below.
4. **A report read and no meals:** the report version below.

### The two small numbers
- Left: meals logged (`mealsLogged`).
- Right, first that applies:
  - The top food when it was logged at least twice: "Most logged: Poha, 4 times" (`topFoods[0]`). Titles over 28 characters are cut at a word with "…". Titles in other scripts are shown as logged, with a `lang` tag.
  - Otherwise, how they logged: "Mostly by voice: 5 of 7" (`loggedBy`), or "By photo, voice and text" when it's even.
- **Never** a meal slot ("breakfast") until the slot bug above is fixed.

### "Up from" line
Only when this week's `daysLogged` is higher than last week's, and last week had at least one. Otherwise nothing. We never say "down".

### Light version (1 or 2 days logged)
> **Priya, here's your week.**
> **[seven squares]**
>
> **2 days**
> logged this week
>
> Two days is enough for a first wrap: what you ate, your protein on those days, and one thing to try.
>
> **[ Play my wrap ]**
>
> Logging a meal takes a photo, a sentence or a few typed words. *(left out when their free meal logs are used up and they have no pass; see decision 6)*

### Report version (a report read, no meals)
> **Priya, your week had a report in it.**
>
> **1 report** read this week
>
> Your wrap puts it next to your week. Log a few meals this week and next Monday's wrap has your food in it too.
>
> **[ Play my wrap ]**

No marker names, values or verdicts (rule 8).

### Other edge cases
- **No name saved:** "Your week is wrapped."
- **Pass or no pass:** same email. It never sells the pass.
- **Free meal logs used up:** no "log more" lines. The wrap still opens.
- **First week after this ships, for existing users:** one extra footer line: "New: a weekly wrap by email. Not for you? Stop weekly wraps." (Decision 1.)

### The link and what happens after the tap
`https://www.d-human.fit/wraps?week=2026-11-16&e={sendId}`

`week` is the Monday the week starts. The Wraps page (`app/(platform)/(app)/wraps/page.tsx`, `components/platform/Wraps.tsx`) needs to read it:

| Situation | What the person sees |
| --- | --- |
| Signed in, wrap made | The story opens on its first card straight away, over the Wraps list, so Close lands on the list. |
| Signed in, no wrap yet | A black screen: "Wrapping 16 – 22 Nov…" while the seven squares fill in left to right, then the story opens. **This is the one moment of motion.** Reduced motion: the squares show complete, no animation. On failure: the Wraps list with its usual error and "Make my wrap". |
| Signed out | Sign-in, then straight back to this link (section 7.3). |
| Someone else is signed in on this browser | Their own Wraps list, nothing opened. The link is only a date; it reveals nothing. |
| The week has no data now (meals deleted) | The Wraps list; the card says "Nothing logged that week." |

The API (`app/api/wraps/route.ts`) takes `offset`; the page works out the offset from `week`, or the API accepts a `start` date. Engineer's call.

---

## 5. Feedback email

### Before and after
- **Before:** we learn what people want only when they write in unprompted, and we never hear from people who quietly stop.
- **After:** about 10 days in, one email with one question answered by one tap. The tap opens a short page with up to three more questions and a box to type anything. People who barely used D-Human get a different first question: what got in the way.
- **Why it helps people:** what they tell us decides what we build. Closing the loop ("you asked, we built it") builds the trust a health product runs on.

### When and how often
- **First ask: day 10 after onboarding, 11:00 am local.** Moves to the next day if it falls on a Monday (wrap day) or if another lifecycle email went that day.
- **At most once every 90 days, at most 3 a year.**
- **After 2 asks in a row with no answer, we stop asking.** They can still answer any time from Settings ("Tell us what to build", section 6).
- **Later asks** come at moments with something to react to, such as 10 days after their second report read. Still inside the caps.

### Who
Everyone who finished onboarding, with feedback emails on. Two versions of the first question:
- **Used it:** meals logged on 3 or more days, or a report read, in the first 10 days.
- **Barely used it:** everyone else. Their answers are the most useful we can get.

### Subject lines
1. `Two taps to shape D-Human` (pick)
2. `What should we build next, Priya?`
3. `One question from the D-Human team`
4. `Tell us what's missing`

### Preheaders
- `Tap an answer right here. Up to three more on the next page, all optional.` (pick)
- `One question, one tap. Typing is optional.`

### Body copy: used it

> **[D-HUMAN wordmark]**
>
> **One question, one tap.**
>
> Hi Priya. D-Human is new, and you've been using it for about 10 days. What you tell us decides what we build next.
>
> **How would you feel if you could no longer use D-Human?**
>
> **[ Very disappointed ]**
> **[ Somewhat disappointed ]**
> **[ Not disappointed ]**
> **[ I haven't used it much ]**
>
> Tapping opens a short page with up to 3 more questions. Skip any of them.
>
> Rather write? Reply to this email. The founding team reads every reply.
>
> ---
> You're getting this because you use D-Human. We ask at most once every 3 months.
> [Stop questions like this](#) · [Email settings](/settings#emails)
> D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.

The first question is Sean Ellis's product-market-fit question in plain words. Its share of "Very disappointed" is the clearest single number for whether D-Human is a must-have.

### Body copy: barely used it

> **One question, one tap.**
>
> Hi Priya. You signed up for D-Human about 10 days ago. If it hasn't stuck yet, we'd like to know why. No wrong answers.
>
> **What got in the way?**
>
> **[ Logging meals took too long ]**
> **[ The meal numbers looked off ]**
> **[ My free meal logs ran out ]**
> **[ I don't have a blood report to upload ]**
> **[ I haven't got to it yet ]**
> **[ Something else ]**
>
> Tapping opens a short page with 2 more questions. Skip any of them.
>
> Rather write? Reply to this email. The founding team reads every reply.

### Answer buttons in the email
- Stacked, full width, 52 px tall, black outline on white, 17 px text. Never side by side on a phone.
- Each is a link: `https://www.d-human.fit/feedback?t={token}&q=feel&a=very` (`q` the question, `a` the answer). The token sits in the query string, which Vercel Analytics already strips (`components/Vitals.tsx`).

### The page after the tap (`/feedback`)
Public, no sign-in, `noindex`, no third-party scripts, `Referrer-Policy: no-referrer`. Black page, wordmark, one question at a time.

1. **Arrival.** The answer they tapped shows as saved: "Saved: Very disappointed ✓  Change". After a short beat (about 0.6 s) the next question slides in from the right (220 ms, ease-out). Reduced motion: it appears with no slide.
2. **Progress** at the top: 4 thin segments (3 for the "barely used" path), filling pale to full green as they answer, like the orbit's progress.
3. **Each question:** big full-width options (at least 52 px), one tap saves it and moves on. "Back" and "Skip" as quiet text buttons. Every answer saves the moment it's tapped, so leaving halfway keeps what they gave.
4. **The last step** is a text box (below).
5. **Done:** "Thank you, Priya. That's everything. We read every answer, and when we build something you asked for, we'll tell you in a wrap email." Button: "Back to D-Human" (`/home`).
6. **Coming back** with the same link: their saved answers show, and they can change them until the survey closes (30 days).

#### Questions: used it
| # | Question | Options (tap one) |
| --- | --- | --- |
| 1 | How would you feel if you could no longer use D-Human? *(in the email)* | Very disappointed · Somewhat disappointed · Not disappointed · I haven't used it much |
| 2 | What do you use most? | Logging meals · My blood report read · My supplement stack · Weekly wraps · Nothing much yet |
| 3 | What should we build next? Pick one. | Blood tests booked through D-Human · Sign in with your phone number or WhatsApp · The whole app in Hindi and other Indian languages · A reminder when it's time to retest · Connect a watch or fitness app · Something else |
| 4 | How likely are you to recommend D-Human to a friend? | 0 to 10, in two rows (0–5, 6–10), "Not likely" under 0 and "Very likely" under 10 |
| 5 | Anything else? | Text box |

Under question 3: "Picking one doesn't mean we'll build it; it helps us choose." "Something else" jumps to the text box with the cursor in it. The options for question 3 are Mayank's call (decision 7); these come from the roadmap and the open items.

#### Questions: barely used it
| # | Question | Options |
| --- | --- | --- |
| 1 | What got in the way? *(in the email)* | as in the email |
| 2 | What should we build next? Pick one. | as question 3 above |
| 3 | Anything else? | Text box |

#### The text box
- Label: "Anything else? A feature you want, something that annoyed you, anything at all."
- Placeholder: "Type here. Please leave out health details; we don't need them here."
- Up to 1,000 characters, with a counter from 800.
- Checkbox, off by default: "You can email me about this." Only then does their email address go with the answer.
- Button: "Send".

#### Link scanners
Work email and some mail apps open every link in an email to check it for danger. A plain "record the answer when the link is opened" would record every option as tapped. So:
- **Opening the link records nothing.** The page loads, then saves the answer with a POST from the page. Without JavaScript, it shows a "Confirm: Very disappointed" button instead.
- **If two different answers to the same question arrive within 10 seconds,** keep neither until a later, single answer.
- The same rule protects the stop links (section 6).

### Where answers go
To the Google Sheet the team already uses, in a new **Feedback** tab (the plumbing engineer builds the path, likely the existing Apps Script web app). One row per answer:

| Column | Example | Note |
| --- | --- | --- |
| Received at | 2026-11-28 11:04 | |
| Survey | fb-1 | which ask this was |
| Respondent | `r_3f9a1c07b2` | a short code made from the user id with a secret; not the email |
| Path | used / barely | |
| Question | feel / use / build / nps / gotinway / text | |
| Answer | very | or the typed text |
| Plan | free / pass | |
| Days since onboarding | 10 | |
| Days with meals logged | 7 | a count, not what they ate |
| Language | en | |
| Source | email-tap / page / settings | |
| Email | only if they ticked "You can email me" | |

- The Sheet holds **no health data and no email address** unless they ask to be contacted. Typed text might include health details anyway, which is why the box asks them not to and why the Sheet stays restricted to the founding team.
- Our database keeps the answers too, so the page can show and change them; they go when the account is deleted. Rows with an email address in the Sheet are deleted when that account is deleted (a manual or scripted step; plumbing engineer's call).

### Replies to the email
- **Reply-To:** one inbox the founding team shares (decision 7). A Google Workspace group on `dhuman.fit` works, since mail there runs on Workspace.
- **Into the Sheet:** a **Replies** tab with received at, from, subject, the reply text without the quoted email, the respondent code when the address matches an account, and a status (new, read, answered). Two ways to get them there, plumbing engineer's call:
  - Resend's inbound email (on every plan, per resend.com/pricing, checked 18 Nov 2026), which would need its own subdomain because `dhuman.fit`'s mail runs on Google Workspace.
  - An Apps Script on the Workspace inbox copying new replies.
- **People, not robots:** no auto-reply. Someone reads every reply within 7 days and answers real questions.
- **Health questions in replies:** we never advise by email. A saved reply for Mayank to approve: "Thanks for telling us. We can't give medical advice by email, so please show this to your doctor. If it feels urgent, get medical help now."

---

## 6. Preferences, stop links and caps

### Kinds of email
| Kind | Examples | Can they turn it off? | Default |
| --- | --- | --- | --- |
| Account | Sign-in codes, payment receipts | No; the account needs them | Always on |
| Welcome | Welcome, "didn't finish" | One-off; nothing to turn off | Sent once |
| Weekly wrap | The Monday email | Yes | Decision 1 |
| Questions from the team | Feedback emails | Yes | Decision 1 |
| *Later:* retest reminders, monthly wrap | | Yes, each separately | Opt-in at the moment it's useful |

### Settings → Emails
A new section in `components/platform/Settings.tsx`, between "Blood reports" (ends line 221) and Sign out (line 223), with the id `emails`:

> **Emails**
>
> **Weekly wrap** [on/off]
> Monday mornings, only after a week with something in it.
>
> **Questions from the team** [on/off]
> A few taps, at most once every 3 months.
>
> Sign-in codes and payment receipts always come; your account needs them.
>
> [Tell us what to build](/feedback) (the feedback page, signed in, any time)

Toggles save on change, like the rest of Settings, with the existing save bar.

If the weekly email was paused (below): "Paused: the last 6 weren't opened from the email. Your wraps are still here. [Turn back on]"

### One-tap stop
1. **In the mail app's own button.** Every lifecycle email carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, pointing at that kind only (for example `…/api/email/unsubscribe?t={token}&kind=weekly`). Gmail and Apple Mail show this as an Unsubscribe button. Resend needs us to add these headers ourselves on API sends (resend.com/pricing, checked 18 Nov 2026).
2. **In the footer.** "Stop weekly wraps" opens `/email/stop?t={token}&kind=weekly`. The page turns it off as it loads (by a POST from the page, for the scanner reason above) and says:

> **Done. No more weekly wraps by email.**
> Your wraps are still in the app whenever you want them.
> [Undo]
>
> **Other emails**
> Questions from the team [on/off]
> Sign-in codes and payment receipts always come; your account needs them.

No sign-in needed. No "are you sure?". No reason survey. No "we'll miss you".

**Stop tokens** are signed and tied to one person and one kind. They don't expire (people stop emails from old messages), and all they can do is change email settings.

### Caps
1. **One lifecycle email a day** per person (their calendar day). Account emails don't count and always go.
2. **Two lifecycle emails in any 7 days.**
3. **3 quiet days after the welcome:** no weekly wrap or feedback email in that time.
4. **If two are due the same day:** welcome first, then the weekly wrap (it's tied to Monday), then feedback, which moves to the next free day that isn't a Monday.
5. **Sending hours:** 8:00 am to 8:00 pm local.
6. **Feedback:** at most once in 90 days and 3 a year; stop after 2 unanswered asks in a row.
7. **Pause the weekly email** after 6 in a row that weren't opened from the email (no tap on any link). Settings says so, and one tap turns it back on. This respects attention and keeps Gmail trusting our mail.
8. **Hard bounces and spam reports** stop all lifecycle email to that address. Resend suppresses them on its side; we mirror it in the send ledger.

---

## 7. What engineers need (requirements, not designs)

### 7.1 Data
- **Email settings per person:** weekly wrap on/off, questions on/off, when the weekly email was paused, and when settings last changed. Deleted with the account. RLS on, no policies, like every table; safe to run twice.
- **A send ledger:** one row per lifecycle email, with person, kind, a unique dedupe key (`welcome:<user>`, `weekly:<user>:2026-11-16`, `feedback:<user>:fb-1`), the person's local date, the variant, sent at, Resend's id, first tap at, and status (sent, failed, bounced, complained). It enforces the caps, stops duplicates and feeds the numbers in section 8. Deleted with the account.
- **Feedback answers:** stored per person and survey, so the page can show and change them. Deleted with the account.

### 7.2 Sending
- **Welcome:** from the profile save, after the response, when `justFinished` is true.
- **Everything else:** one scheduled job that runs at least hourly (people outside IST need their own 8 am), picks who is due, checks the caps, pre-makes wraps for the weekly email, then sends. Resend has a batch API for sending many emails in one call.
- **Check the Vercel plan's limits on scheduled jobs** before choosing hourly. If only daily runs are possible at first, run at 02:30 UTC (8:00 am IST) and send only to people for whom it's 8 am–8 pm.
- **Resend's daily limit:** see decision 2. Sign-in codes share the same quota; codes must never fail because a Monday batch used it up. Keep a margin, or send account emails from a separate stream.
- Templates live beside the waitlist one (for example `lib/email/`), with a dev preview for each email and variant at `/api/email-preview?kind=…` (404 in production, like today's).

### 7.3 Sign-in that remembers where you were going
Today `app/api/auth/verify/route.ts:30` always sends people to `/home` or `/onboarding`. Email links need sign-in to carry a destination (`next`) and return there afterwards:
- Only paths on our own site: must start with a single `/`, never `//` or a full URL.
- Onboarding still comes first for someone who hasn't finished it.
- The email address is never put in a link.

### 7.4 Measuring taps with `e`
- Every button carries `e={sendId}`. When the page loads signed in as the email's owner, the server records the first tap on that send, then the page removes `e` from the address bar so it isn't copied or shared.
- `e` gives no access to anything. If the signed-in person isn't the email's owner, it's ignored.
- A tap that hits sign-in first counts once sign-in succeeds.
- The weekly wrap viewer also records when the story reaches its last card ("One thing"), so we know who saw the advice, not just who opened the email.

### 7.5 Tokens
- Feedback and stop links use signed tokens (an HMAC, as in `lib/waitlist/token.ts`), with a key derived from an existing server secret for this purpose only. Names only, never values.
- Feedback tokens: one person, one survey, 30 days. Stop tokens: one person, one kind, no expiry.
- `qa-security-engineer` tests: forged and swapped tokens, token reuse across people, link scanners, open redirects through `next`, and that no page shows anyone else's data.

### 7.6 Before the first send
- **DMARC on `dhuman.fit`** (an open item in MEMORY). Gmail and Yahoo require it of bulk senders, and it helps any sender reach the inbox.
- **Fix the wraps' breakfast label** (open item) before the weekly email goes out.
- **Add one line to onboarding's consent step** (`components/platform/Onboarding.tsx:469–491`), wording set by decision 1. For example: "We'll email you a weekly wrap on Mondays and, now and then, a quick question. Turn either off in Settings or from any email."

---

## 8. How we'll know it worked

All of these come from the send ledger and the app's own data, not from open pixels.

| Email | Main number | Also watch |
| --- | --- | --- |
| Welcome | Share of new people who log a first meal within 24 hours of onboarding | Share who come back on a second day in their first week; taps per email |
| Weekly wrap | Taps that reach the wrap's last card ("One thing"), per send | **Health behaviour:** days with meals logged per week, and days the protein aim was reached per logged week, over 4 to 8 weeks. Stop rate per send. Spam reports per send. |
| Feedback | Share who answer question 1 | Share who reach the text box; share of "Very disappointed" (the must-have signal); the top "what got in the way" reason |

**Guard rails, our own targets:**
- Stops under 0.5% of each weekly send.
- Spam reports under 0.1% (Google's sender guidelines ask senders to stay under 0.3%).
- If either is crossed two weeks running, pause the weekly email and look again.

**Does the weekly email change behaviour, or just get opened?** The honest test is a holdout: a random 10% of eligible people don't get the weekly email for 8 weeks (their wraps still work in the app), and we compare logging days and protein-aim days. That's only meaningful with a few hundred people in each group, so: before/after at launch, holdout once weekly recipients pass about 500 (decision 9).

---

## 9. Decisions for Mayank

1. **Default on, or opt-in?** Weekly wrap and feedback emails on by default, with a line on the consent step and one-tap off everywhere (my pick), or off until people turn them on. This is a DPDP and legal call. Existing users would see a one-time "New: a weekly wrap by email" line in their first one.
2. **Resend plan (money).** Free allows **100 emails a day and 3,000 a month** (resend.com/pricing, checked 18 Nov 2026), shared with sign-in codes. Pro is $20 a month for 50,000. Upgrade before Monday sends pass about 70 people, or codes start failing.
3. **Send time:** Monday 8:00 am local for the finished week (my pick), or Sunday around 6:30 pm with the week still running.
4. **Signed-out taps:** require sign-in and come back to the wrap (my pick at launch, with `next`), or a signed link that opens only that week's wrap, read-only, for 14 days. Most Indian users are on Android, where Gmail's links usually share Chrome's sign-in (my inference, not tested). iPhone home-screen app users will usually land signed out. Measure tap-to-played and revisit.
5. **Pre-make wraps at send time:** about $0.40 a week per 1,000 recipients, for an instant open (my pick).
6. **Free allowance in emails:** the welcome says "Free to start: 2 report reads and 20 meal logs. No card needed." No price anywhere in these emails. When free meal logs run out, the weekly email stays quiet about it (my pick), or adds a plain line about the pass.
7. **Feedback:** who signs it (a named founder lifts replies only if that person really reads them); which inbox replies go to; who reads them within 7 days; the "build next" options; and approval of the saved reply for health questions.
8. **Language:** English only for launch. Hindi and Hinglish versions after the native-speaker check that's already an open item.
9. **Holdout:** 10% without the weekly email for 8 weeks, once there are about 500 weekly recipients.

---

## 10. Copy checklist (run on every email and variant)

- [ ] No: missed, failed, broke, streak, behind, only (about their effort), last chance, hurry, don't lose, we miss you, cheat, guilt-free, junk, over (a target).
- [ ] No diagnosis words; no marker names, values or verdicts; no calorie numbers or weight.
- [ ] "Free to start", never "free" on its own. No "accurate". No "doctor-reviewed". Meal numbers called "AI estimates"; reads called "AI".
- [ ] Subject and preheader: no health or food data.
- [ ] One primary button; tap targets of at least 44 px; the plain-text part matches.
- [ ] Footer: why they got it, one-tap stop (not on the welcome), Email settings, the disclaimer.
- [ ] Checked at 390 px in Gmail (Android and iOS) and Apple Mail, with images on and off.

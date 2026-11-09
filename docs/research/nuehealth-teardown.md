# Nue Health front-end teardown

**Target:** https://www.nuehealth.in/ (marketing site) and https://app.nuehealth.in/onboarding (where every "Join today" leads)
**Captured:** 9 Nov 2026, logged out. Nothing was submitted: no phone number, OTP, booking, payment or account.
**Why:** design research for D-Human. The section on reports and markers (section 11) matters most.

## How this was gathered

- **Browser captures:** REA CLI 6.7.0 `capture-browser-scenario` in launch mode, running headless Google Chrome 156 with motion allowed. Viewports were 1440 x 900 (DPR 1) and 390 x 844 (DPR 2). Each capture paged through the site with `PageDown` and took a screenshot after every step. The only clicks were "Decline" on the cookie banner, the mobile menu button, a biomarker row, and the onboarding "Get Started" / "Next" buttons up to the phone-number screen.
- **Static files:** I fetched the homepage HTML and all 11 CSS files (129,527 bytes) with curl, plus the main JS bundle (559 KB) and its 26 lazy chunk files (16 JS, 10 CSS). Colours, sizes, radii, easings and keyframes below are counted from those files.
- **The app bundle:** the onboarding app at `app.nuehealth.in` ships its whole JS and CSS to logged-out visitors, in 220 lazy chunks plus a 290 KB Tailwind CSS file. I read the results, twin, onboarding and dashboard chunks without running them. Anything I say about the logged-in results UI comes from that code and from Nue's own marketing images of it, not from a real account.
- **A public sample report:** `app.nuehealth.in/sedona-sample-report.pdf` is a 27-page sample "Proteomic Aging Report" from **Sedona**, a sister brand built on the same codebase (see Stack). It is not Nue-branded. I used it as evidence of how this team designs reports.

**Labels used throughout:**
- **[O] Observed:** read directly from CSS, JS, DOM or a screenshot.
- **[I] Inferred:** my reading of the evidence; it may be wrong.

Screenshot IDs such as `[H1]` are listed with their full paths in section 14.

---

## 1. Stack

| Layer | What they use | Evidence |
|---|---|---|
| Marketing framework | Vite + React 19.2.4 single-page app, served as pre-rendered HTML that hydrates (`<div id="root" data-prerendered="true">`), with React Router | [O] `/assets/index-DKnP2dfU.js`, `__vite__mapDeps`, version string `"19.2.4"`, route table: `/`, `/biomarkers`, `/compare`, `/download`, `/waitlist`, `/support`, `/privacy`, `/terms`, `/delete-account`, `*` |
| Styling | CSS Modules with Vite's naming (`_section_zqkef_1`). The colour tokens live in a JS object and are injected as inline CSS custom properties per section | [O] e.g. `"--landing-ink":je.black`; the hex values sit in JS, not CSS |
| Hosting | Vercel, Mumbai edge | [O] `server: Vercel`, `x-vercel-id: bom1::…`, `x-vercel-cache: HIT` |
| Media | Supabase Storage, including its image-render endpoint, for every image and video | [O] `qzeumzgreipptqxjgxtu.supabase.co/storage/v1/render/image/public/website/*.webp` |
| 3D / generative | Raw WebGL through a tiny OGL-style wrapper with hand-written GLSL: a particle field plus a ring of "ticks" whose colours are uniforms | [O] `getContext("webgl2")`, the "unable to create webgl context" message, four shader programs in `ImmersiveSequence-*.js`. [I] that the wrapper is OGL |
| Motion libraries | None. No GSAP, Lenis, Framer Motion or Lottie. Scroll scenes are hand-rolled with `requestAnimationFrame`, `getBoundingClientRect` and a critically damped spring | [O] library search returned zero hits; the spring function is in the chunk |
| Analytics | PostHog with session replay (behind a consent banner), Sentry, Vercel Web Analytics and Speed Insights | [O] strings in the bundle; banner text "Help improve this site with optional analytics and session replay" |
| Fonts | PP Neue Montreal (Medium 500 as woff2, Italic as otf), GT Standard (three **"Trial"** .otf files, declared but almost unused), Geist Mono variable | [O] `@font-face` rules; file names `GT-Standard-L-Standard-Regular-Trial-*.otf` |
| App (`app.nuehealth.in`) | A second Vite + React app: Tailwind 3 with shadcn/ui-style HSL tokens, Supabase auth, an API at `api.sedonahealth.in/api/v2`, Razorpay and Stripe chunks, Google Places autocomplete, Recharts | [O] `--primary: 24 10% 10%`, `sb-*-auth-token`, chunk names `razorpay-*.js`, `stripeAppearance-*.js`, `CartesianGrid-*.js` |
| One codebase, two brands | The app is built with `VITE_APP_VARIANT: "nue"`. The other variant is `"sedona"`: a US proteomics brand with US demo data (San Francisco address, "GetLabs" home draws) | [O] `I={sedona:{optimal:"Strong",in_range:"On track",out_of_range:"Focus area"},nue:{optimal:"Optimal",…}}`. [I] Nue is the India edition of Sedona Health's platform; the footer names "Sedona Health Pvt. Ltd." |

[O] The privacy-policy chunk links to Tata 1mg Labs' privacy policy. [I] That lab runs the draws and assays.

---

## 2. Anatomy: homepage sections in order (1440 x 900)

Every section is about one screen tall; the CSS sizes most of them as `calc(100svh - var(--navbar-clearance))`. The page alternates between a near-black film (`#0A0A0A`) and a pale grey page (`#F7F7F7`), then ends on a warm brown-black footer.

| # | Section | What it is | Shots |
|---|---|---|---|
| 01 | **Floating nav** | [O] A pill bar fixed 12 px from the top, `width:min(960px, 100% - 32px)`, 60 px tall, radius 999 px. The background is frosted glass (a 115° gradient of white at 58% → 18% → 24% → 52% alpha, `blur(12px) saturate(180%)`). It has three columns: "What we measure" link on the left, the NUE logo in the middle, and a black "Join today" pill on the right. Over dark sections its text turns white (`_overlayDark`, a 0.4 s colour transition). | [H1] |
| 02 | **Hero** | [O] A full-bleed photo (a woman under palm trees, warm light) under two gradient scrims. Centred: the eyebrow "PRIVATE BETA" (12 px, uppercase, 0.15 em tracking), the H1 "India's 1st blood testing subscription", the line "For people who understand that health is a lifelong practice, not a one-time checkup.", a white "Join today" pill, and three proof points split by hairlines: At-home blood test \| Your digital twin \| Personalised Nue protocol. | [H1] |
| 03 | **The scroll film** ("See your health change, blood test by blood test") | [O] A sticky WebGL scene. The track is `100svh + steps × 120svh` tall. A ring of a few hundred radial ticks (my estimate from the screenshots) builds from particles while a centred text reel steps through four stages: "Blood draw 1 / Establish your baseline. Know where you're starting." → "Understand your results / See your digital twin. Follow your Nue protocol." → "Blood draw 2 / Test again. See what's changing inside you." → "Your next step / Always know where to focus next." + CTA. Around the ring sit HUD-style marker boxes in bracket labels (`[hs-CRP] Inflammation`, `[ApoB] Heart health`, `[Goal] Better sleep`) and mono rows (`[HS-CRP] [APOB] [CREATININE] [SLEEP] [HABITS]`). In the last stage the ring's arcs take on status colours and four labels appear: Inflammation · HS-CRP · ↑ Improving (green); Blood sugar · HBA1C · GLUCOSE · ↑ Improving (green); Heart health · APOB · CHOLESTEROL · – Unchanged (purple); Liver health · ALT · AST · ↓ Needs attention (red). Hidden alt text says "Illustrative changes between blood tests, not actual patient results". | [H2] [H3] [H4] [H5] |
| 04 | **How it works** | [O] Three white cards (radius 12) on grey, each with a "STEP n" pill: (1) a NUE-branded blood tube in front of a ring of ticks, "Complete your first test, 77 blood biomarkers…"; (2) three "Daily" protocol tiles on photographic textures: "2g Omega-3 (EPA+DHA)", "200mg Magnesium Glycinate + 3g Glycine before bed", "30g walnuts + 1 tbsp flaxseed"; (3) a marker card, "Apolipoprotein A1 (Apo A1) · Cardiovascular · ● Optimal — 170 mg/dL", with a four-point sparkline that moves from purple dots to green dots and a blurred "HDL Cholesterol" card behind it. Then a black "Join today". | [H6] |
| 05 | **"1 action protocol / 10 organ systems / 77 biomarkers"** | [O] A sticky scene in a 200vh wrapper: three phone screenshots fan out as you scroll (`--progress`, `--spread`). Left, the Protocol screen; centre, the "Explore your systems" twin video; right, the Results summary. | [H7] |
| 06 | **"One membership / All of this"** | [O] The heading and CTA stick on the left while four photo cards (radius 12, 320 px tall, a blur-masked bottom band behind a white label) scroll on the right: Test every 3, 6 or 12 months · A digital twin · Your supplementation protocol · Your nutrition protocol. | [H8] |
| 07 | **"Optimise for life"** | [O] A 300vh sticky video (a sprinter on an Indian stadium track). The card's width, height and radius are scroll-driven, from a rounded pill to full-bleed. Two `<video>` elements cross-fade to hide the loop seam, and Safari gets a plain autoplay fallback. | [H9] |
| 08 | **Comparison** ("Nue goes way beyond your annual health checkup") | [O] A table on a sage-to-deep-green photographic gradient (`comparison-bg.webp`), white text, columns Nue (with logo) vs "Others". Rows: Predictive biomarkers, Personalised action protocol, Automated booking, Number of draws (Multiple vs 1), Biological age, Digital twin, 10 system health grades, India-specific ranges, AI chat with data ("Coming soon" pill). Each row's description expands with `grid-template-rows 0fr → 1fr`. | [H10] |
| 09 | **Pricing** ("The same panel, repeated every 3, 6 or 12 months") | [O] Two white cards (radius 24): Core membership · 77 biomarkers · ₹2,999 per test, and Advanced membership · 93 biomarkers · ₹6,999 per test. On hover a 52 px textured orb grows to about 1000 px over 3 s and floods the card (deep green for Core, purple for Advanced), the text turns white, and the card tilts in 3D (`perspective(800px) rotateX/Y`, at most 4°, follows the cursor). At 768 px wide or less, each card floods once, when an `IntersectionObserver` sees it 85% in view, and stays flooded. Both cards link to `/biomarkers#list`, not to checkout. | [H11] [M9] |
| 10 | **FAQ** | [O] Nine questions, the first open. "+" icons, the answer height animated over 0.8 s. Answer text is a warm grey `#70625A`. | [H12] |
| 11 | **Footer** | [O] Warm near-black `#100C0A`, top corners rounded 40 px. A four-dot logo mark, "A new kind of healthcare", a paper-coloured "Join today" (`#EAE5DF`), social icons, Terms / Privacy / Cookie settings, the line "All laboratory and medical services are provided by independent third parties.", and a giant "NUE" wordmark used as a CSS mask over a looping video. | [H13] |
| — | **Cookie banner** | [O] Bottom left, max 384 px, 1 px `#6B7280` border, three choices: Decline / Allow analytics / Privacy policy. It appeared on the homepage, `/compare`, `/waitlist` and `/download`, but not on `/biomarkers`. | [H2] (first run) |

[O] In the pre-rendered HTML, the scroll-film section comes *after* the footer. On screen it is the second section. [I] It is a lazy chunk (`ImmersiveSequence-*.js`) mounted into its slot after hydration.

**Other pages**
- **`/biomarkers` ("What we measure"):** a violet-blue hero with a point-cloud body (`mix-blend-mode: color-dodge`), frosted marker cards floating at different blur depths, and a central card "●●●● 4 of your signals changed since your last blood draw" (three green dots, one red-orange). Below it on black: a sticky sidebar with search and a "By area" list of the 10 systems (Metabolic, Heart, Immune, Thyroid, Reproductive, Brain, Musculoskeletal, Blood, Liver, Kidney), each with a round organ icon; then per-system tables. Each table opens with a white pill bar (the name, plus a mono count such as "14 BIOMARKERS"), followed by `details/summary` rows with green-check columns CORE / ADV(M) / ADV(F). [B1] [B2]
- **`/compare` (in the sitemap, not in the nav):** "What we measure" with a row of big counts that **names competitors**: 77 Nue Core · 93 Nue Advanced (male) · 93 Nue Advanced (female) · 108 Function Health (male) · 106 Function Health (female) · 79 Orange Labs (male) · 79 Orange Labs (female). Below that is a marker-by-marker table by panel (Lipid, Thyroid, CBC, Iron, Liver, Kidney, Heavy metals, Autoimmunity, Pancreas, Nutrients incl. Omega-3 index, Hormones). The Nue columns sit in a dark warm-brown band (`#2A2321`); availability is shown with green ticks and red crosses; rows Nue lacks are greyed. It uses the older warm palette (`#2A2321` ink, `#F3F0EB` paper) and an older flat nav (logo left; What we measure · How it works · Membership on the right). [C1]
- **`/waitlist`:** a leftover pre-launch form on a soft sage radial gradient: "Be the first to experience Nue / We're launching on July 1…", with pill fields for name, +91 phone (with an Indian flag) and DD / MM / YYYY, and a black "Join waitlist". I left it blank. [W1] **`/download`:** "Get the Nue app on your phone", a QR code in a white rounded tile, and black Google Play / App Store badges, under the older flat nav. [D1]
- [O] The bundle also contains an invite modal that isn't linked anywhere visible: "We're inviting 20 people to experience Nue's beta for free", asking for an email, an X/LinkedIn link and "Why do you want to be a founding member?".

---

## 3. Colour

### 3a. Tokens (declared in JS and applied as CSS variables)

[O] The marketing bundle holds one palette object. The sections read it as inline CSS variables, and the WebGL chunk imports it to build its colour uniforms (`W(I.green1000)`, `W(I.purple500)`, `W(I.red500)`, neutral `W(I.gray500)`):

```js
black:#0A0A0A  white:#FFFFFF
gray100:#F7F7F7  gray300:#EDEDED  gray400:#E8E8E6  gray500:#D6D6D4  gray600:#A6A5A2
gray700:#767674  gray800:#252525  gray1000:#1A1A1A
green100:#CFF4D4  green1000:#4EAC72
red500:#CB5A43    red1000:#B43F27
purple500:#A08FC0 purple1000:#8C6FC1
statusOrange1000:#E67E42
```

[O] The app adds these to the same base:

```
gray200:#F3F3F3  gray650:#9E9D9A  gray900:#202020
twinGreen:#6EB25E  sage500:#879677  sage900:#30453B
red100:#F7ECE9  purple100:#F4E2F7  statusOrange500:#F9DFD0  statusRed1000:#DB1A1A
insightAmber:#CA732C  insightViolet:#5E2FB6  betaTakeawayAccent:#CDB9F6
blue500:#D7DDEA  blue1000:#214CA0  teal100:#CDEEEC  teal1000:#1F7E7A  vividOrange:#FF5A00
--color-high-normal:#D27E6E
```

[O] Its Tailwind `:root` uses shadcn-style HSL values: `--foreground: 0 0% 5%`, `--primary: 24 10% 10%` (a warm near-black), `--destructive: 7 70% 44%`, `--chart-1: 150 41% 48%` (green), `--chart-2: 7 70% 44%` (red), `--chart-3: 259 29% 59%` (purple), `--chart-4: 0 0% 62%`.

### 3b. Occurrences in the shipped CSS

[O] Across the 11 marketing CSS files there are 351 hex values (97 unique, counting alpha variants) and 31 `rgb()`/`rgba()`. Top values:

| Hex | Uses | Role (where it appears) |
|---|---|---|
| `#FFFFFF` | 61 | Cards, type on dark sections |
| `#0A0A0A` | 53 | Ink, primary buttons, dark film sections; `theme-color` meta |
| `#F7F7F7` | 23 | Page background (`body`), light sections |
| `#000000` | 20 | Video and immersive backgrounds |
| `#2A2321` | 20 | Warm ink, only on Compare, Legal, 404 and Delete-account |
| `#EAE5DF` | 13 | Warm "paper": footer CTA, the button hover texture |
| `#9E9D9A` | 10 | Muted text: card descriptions, period, legal |
| `#A6A5A2` | 5 | Muted text on dark |
| `#767674` | 4 | Muted labels, placeholders |
| `#100C0A` | 4 | Footer background |
| `#202020` | 4 | Table hairlines on dark |
| `#93857D`, `#5C4F4A`, `#70625A` | 4 / 3 / 1 | Warm greys (legal pages, FAQ answers) |
| `#E07A5F`, `#FFAB96`, `#B43F27` | 3 / 2 / 1 | Form error states only |
| `#4EAC72` | 2 | Focus ring and check icons on `/biomarkers` |

[O] Alpha is used as much as hue: `#FFFFFF1A` (10%, ×6), `#FFFFFF0D` (5%, ×4), `#0000001A` (×4), `#FFFFFF80` (×3), `rgb(255 255 255 / .15–.3)` for hairlines and outlines on dark.

### 3c. How colour is used

- [O] **The chrome is monochrome.** Every button, nav, heading and table is black, white or a grey. The page base is `#F7F7F7`, not pure white.
- [O] **Hue is reserved for health status:**

  | Meaning | Static / trend label | Colour |
  |---|---|---|
  | Good | Optimal / Improving | green `#4EAC72` |
  | Acceptable | In range / Unchanged | purple `#8C6FC1` (`#A08FC0` on dark) |
  | Bad | Out of range / Declining or Needs attention | red `#B43F27` (`#CB5A43` on dark) |
  | Pending | — | orange `#E67E42` |

  The inline arrow icons use green `#2E8F52` (up) and red `#B43F27` (down).
- [I] **Purple, not amber, for "in range".** This avoids the traffic-light reading, so a normal-but-not-optimal value doesn't look like a warning. It is the most distinctive colour decision on the site.
- [O] **Atmosphere comes from images, not tokens:** photographic gradients (sage-green comparison table, green and purple pricing orbs, orange-red "Concerning" card, blue-sky biological-age screen, violet biomarkers hero) and warm lifestyle photos. Login and onboarding sit on a blurred green "grainient" (`#879677` → `#30453B`, grain 0.04).
- [O] The status colours also live inside the WebGL shader: the ring's arcs fade from neutral grey `#D6D6D4` to their organ's status colour as particles land ("Neutral with a status whisper, organ tone revealed" is a comment in the shader).

---

## 4. Type

- [O] **One family, one weight.** PP Neue Montreal **Medium 500** is the body and display face: `font-weight:500` ×96, `var(--weight-medium)` ×29, `400` only ×3. Only the Medium (woff2) and Italic (otf) faces are shipped, so there is no bold. `body` is 500 / 1.5 / `-0.01em`, `#1A1A1A` on `#F7F7F7`, antialiased, `font-synthesis:none`.
- [O] **Mono for data.** Geist Mono labels marker abbreviations and HUD tags: `500 11px/1.2`, uppercase, `0.02em` (e.g. `APOB · CHOLESTEROL`), and `13px` with `0.24em` tracking for marker rows (`[HS-CRP] [APOB] …`). The `/biomarkers` table headers and counts use Geist Mono 12 px uppercase.
- [O] **Tight display tracking.** The hero H1 is `clamp(36px, calc(5.1vw - 8px), 70px)` / 1.02 / `-0.04em` with `text-wrap: balance`; the scroll-film titles are `clamp(34px, 3.6vw, 54px)` / 1.04 / `-0.04em`; section H2s are 48 px / 100–110% / `-0.01 to -0.02em`.
- [O] **Height-aware sizes.** Many sizes clamp on `vh` rather than `vw`: `clamp(32px, 6vh, 48px)` ×8, `clamp(13px, 2vh, 16px)` ×7, `clamp(14px, 2.2vh, 18px)` ×5, plus 12 `@media (max-height:700px)` blocks. [I] This keeps one-screen sections inside short laptop screens.
- [O] **Most-used sizes:** 14px (38) · 16px (33) · 15px (18) · 13px (17) · 12px (16) · 20px (14) · 18px (14) · 48px (11) · 24px (9) · 10px (9) · 17px (9) · 32px (7).
- [O] **Letter-spacing:** `-0.01em` (73 of 105 declarations), `-0.02em` (6), `-0.04em` (5). Positive tracking only on uppercase eyebrows and mono (`0.15em`, `0.24em`, `0.13em`).
- [O] **Line-height:** 120% (30), 1.5 (16), 1.2 (15), 110% (11), 1.4 (8), 130% (8).
- [O] **App type scale** (Tailwind utilities, all PP Neue Montreal 500, `-0.01em`): display-hero 48/100%, display-heading 40/100%, display-article 36/110%, heading-xxl 32/110%, xl 24/130%, l 20/130%, m 18/130%, sm 16/130%, body-lg 16, md 15, sm 14, xs 12. Big numbers in results use 44 px, `leading-none`, `-0.02em`.
- [O] **Eyebrow:** 12 px uppercase, `0.15em`, muted (`#D6D6D4` on the dark hero).

---

## 5. Layout

- [O] **Tokens:** `--landing-content-width: 1200px`, `--landing-gutter: clamp(20px, 4vw, 48px)`, `--landing-section-space: clamp(48px, 6vw, 80px)`, `--landing-column-gap: clamp(32px, 5vw, 64px)`, spacing `8 / 16 / 24 / 32`, control height 56 px. The nav is 960 px max; the comparison and pricing blocks are about 650 px.
- [O] **Gaps:** 12px (18) · 8px (16) · 16px (14) · 24px (12) · 10px (11) · 48px (9) · 20px (9).
- [O] **Radii:** buttons are pills (`40px` ×8, `999px` ×10, `1000px` ×6, JS `pillRadius: 9999`); cards use `16px` (×10, JS `radius: 16`), `12px` (×5) and `24px` (×4, pricing); the footer and the "Optimise" video card use `40px 40px 0 0` and a scroll-driven radius. App: `--radius-sm 6px`, `--radius-md 12px`, `--radius-lg 24px`, cards `rounded-[20px]`.
- [O] **Shadows are nearly absent.** The nav has `0 8px 28px #00000014`; pricing cards have `inset 0 1px #FFFFFFE6, 0 2px 8px #0F172A0D, 0 12px 28px #0F172A0F`. App: `--shadow-card: 0 1px 2px rgba(0,0,0,.05), 0 2px 4px rgba(0,0,0,.02), 0 0 0 .5px rgba(0,0,0,.08)`, i.e. a 0.5 px hairline in place of a border.
- [O] **Breakpoints (count of `@media` blocks):** `max-width:768px` (19), `max-height:700px` (12), `max-width:900px` (7), `767px` (7), `760px` (7), `600px` (5), `min-width:769px` (4), `1023px` (3), `360px`, `1100px`, `1199px` (2 each). Plus `(hover:hover)` ×6, `(prefers-reduced-motion:reduce)` ×22, `(prefers-reduced-transparency:reduce)` ×1.
- [O] **Viewport units and stickiness:** `svh` ×21, `dvh` ×8, `position:sticky` ×9. `html` sets `scroll-behavior: smooth` and `scroll-padding-top: calc(88px + safe-area)`.
- [O] **Tap targets:** nav links, buttons and FAQ triggers have `min-height:44px`; the primary CTA is 52–56 px.

---

## 6. Components

| Component | Spec | Notes |
|---|---|---|
| Primary button | [O] `#0A0A0A` pill, 52 px tall, 0 28 px padding, 18 px / 500 / `-0.01em`, white text. On hover a `#EAE5DF` layer with an inline SVG fractal-noise grain fades in (0.8 s) and the text turns black, while a soft ring ripples out (`_buttonRipple` 1.5 s). | A tactile, paper-grain hover on a flat black pill. The footer button inverts it (paper → `#252525` grain). |
| Hero / film CTA | [O] White pill, 54 px, `0 4px 18px #00000024`. Hover goes to `#E8E8E6`. | |
| Nav pill | [O] Frosted gradient glass, three columns, black "Join today". On mobile: logo, Join today, hamburger. | |
| Step / stage pill | [O] 32–34 px, `#F3F3F3` on light; `#FFFFFF14` with 88% white text on dark. | "STEP 1", "Blood draw 1", "Your next step" |
| HUD marker box | [O] 1 px `rgb(255 255 255 / .3)` border with 5 px white squares on its corners; a Geist Mono `[tag]` above; 17 px label. | `[ApoB] Heart health`. A scientific-instrument look. |
| Status label (film) | [O] Name 20 px / `-0.02em`; markers in 11 px mono caps; status 14 px with a 14 px circle-arrow icon (up green, down red) or an 8 × 2 px dash (unchanged, purple). | |
| Protocol tile | [O] A photographic texture (macro food or supplement) with radius 14, a "Daily" glass tag, centred white 13 px text. | |
| Marker card | [O] Grey card: marker name; system in muted grey; a white pill "● Optimal"; a white pill "170 mg/dL" (unit in grey); a sparkline whose dots take the status colour. | [A3] |
| Comparison table | [O] Green photo-gradient panel, radius 16, `#FFFFFF1A` hairlines, white check discs, a dash for "no", row hover highlight `#00000026` with rounded ends. | |
| Pricing card | [O] White, radius 24, layered soft shadow. On hover the orb floods the card and it tilts. | [H11] |
| FAQ accordion | [O] 20 px question, "+" rotates on open (0.8 s `cubic-bezier(.22,1,.36,1)`), `max-height` transition. | |
| Biomarker table | [O] Sticky sidebar: a 56 px pill search with a 1 px `rgb(255 255 255 / .15)` border; a category list with 32 px round icons; the active category gets `#FFFFFF1A`. Rows are `details/summary`, 56 px, with 1 px `#FFFFFF26` dividers inset 32 px, a hover tint, and a chevron that rotates. Panel columns show green check icons (`#4EAC72`). | [B2] |
| Frosted result card (`/biomarkers` hero) | [O] `#0000001A` fill, `blur(12px)` backdrop, radius 14–16, name, big value, and a trend pill (`#FFFFFF0D`, coloured dot + "Improving"). The cards further back get `filter: blur(.7px)` and smaller type, for depth of field. | [B1] |

---

## 7. Motion

**Easing and timing (from the CSS)**
- [O] `cubic-bezier(.22,1,.36,1)` (an ease-out-quint feel) ×21 is the house curve. Then `cubic-bezier(.25,.1,.25,1)` ×5, `cubic-bezier(.5,0,0,1)` ×4 (footer logo, success rotate), `cubic-bezier(.2,.7,.2,1)` ×2 (accordions), `cubic-bezier(.4,0,1,1)` ×1 (exit). The plain keyword `ease` appears 47 times.
- [O] The app defines the curves as tokens: `--ease-smooth: cubic-bezier(.22,1,.36,1)`, `--ease-out: cubic-bezier(.17,1,.32,1)`, `--ease-spring: cubic-bezier(.35,1.55,.65,1)`, `--ease-in-out: cubic-bezier(.66,0,.34,1)`, with durations `.15s / .2s / .28s`.
- [O] **Duration tiers:** 0.15–0.22 s for hover and state colour; 0.26–0.36 s for menus, modals and overlays; 0.7–0.8 s for section re-theming (`--landing-*` transitions at 0.7 s), button grain, FAQ and comparison rows; 1.2–3 s for ambient effects (pricing orb growth 3 s, background 2.8 s); 3.5–4.8 s orb "breathing" pulses; a 20 s orb spin.
- [O] **Keyframes (29 unique):** `buttonRipple`, `startTestingRipple`, `orbPulseA/B`, `orbSpin`, `menuIn`, `mobileOverlayIn/Out`, `mobileLinkReveal/Hide`, `contactIn/Out`, `backdropIn/Out`, `inviteIn/Out/Fade/Close/Return/Backdrop`, `appear`, `spin`, `confirmationIn`, `pageIn`, `shake`, `dobReveal`, `submitRipple`, `successIn`, `successRotate`.

**Scroll behaviour**
- [O] Native scrolling (`scroll-behavior:smooth`), no smooth-scroll library.
- [O] Three sticky scroll scenes: the scroll film (`100svh + steps × 120svh`), the phone fan (200vh), and the "Optimise" video card (300vh). In the scroll film, JS measures `getBoundingClientRect()`, works out progress, and **smooths it with a critically damped spring** (smooth time 0.15 s) before writing the WebGL uniforms (`uArrive`, `uReveal`, `uUnlock`). The phone fan and the video card compute progress from `scroll` and `resize` listeners inside `requestAnimationFrame`, and write it to CSS variables (`--progress`, `--spread`, `--fit`) or inline width, height and radius.
- [O] The WebGL loop runs only while the canvas is in view (`IntersectionObserver`) and the tab is visible, and there is a `webglcontextlost` handler. [I] That handler swaps in the static fallback; the code shows the handler, not the fallback.
- [O] What the shaders do, from their own comments: particles fly in on a cubic ease-out with "a short clockwise swirl onto the tick"; far particles defocus into soft bokeh ("Depth of field"); particles "hand over to crisp ticks on landing"; on unlock "arcs light in turn with a kick" and a "pulse laps clockwise from 12 with a fading tail"; unbuilt marks stay as "a faint track" at 9% alpha.
- [O] Text in the scroll film runs in a "reel": a container masked to fade 56 px at top and bottom, whose strip translates between slots.
- [O] **Reduced motion:** there are 22 reduced-motion blocks. Under `prefers-reduced-motion: reduce`, or on a landscape phone under 500 px tall, the scroll film switches to `data-mode="stacked"`: a static ring with stacked text blocks, no pinning, and the floating labels hidden.
- [O] **Hover tilt:** pricing cards rotate up to 4°, following the pointer (or a touch) through `requestAnimationFrame`.

---

## 8. Imagery

- [O] **Photography:** warm, natural-light, shallow-focus lifestyle shots of Indian subjects (the hero woman under palms, a runner in an orange top in a park, a sprinter in a stadium at dusk, hands with an amber supplement bottle, a grain bowl). Colours lean warm and slightly desaturated.
- [O] **Texture as surface:** macro photos (fish-oil capsule edges, leaves, folded amber paper) fill the protocol tiles, pricing orbs and comparison background. The colour on the site comes from these images rather than from flat fills.
- [O] **Product renders:** a white NUE-branded blood tube with a maroon cap, set against a ring of ticks (the same ring as the film).
- [O] **The data visual:** a point-cloud human body, with organs lit green, purple or red on black. It appears in the app ("twin"), in marketing phone mockups, and as the violet hero on `/biomarkers`.
- [O] **App screenshots** in realistic phone frames, sometimes held in hands against grey seamless paper.
- [O] **Delivery:** WebP through Supabase's image endpoint. The hero has a `srcset` from 768 to 2400 w. **The HTML preloads 16 images**, including `product-1.webp` (3000 × 6213, 4.9 MB) and `product-3.webp` (3000 × 6220, 2.5 MB). In my curl test, the preloaded set came to about 10.6 MB. Videos: `product-2.mp4` (706 × 1488, 45 fps, 22.9 s, 18.9 MB), `optimise_v3.mp4` (1920 × 1080, 8.8 s), `footer.mp4` (1920 × 1080, 7 s).

---

## 9. Flows: landing to booking to report

**Marketing → onboarding.** [O] All nine "Join today" CTAs in the homepage HTML (the same markup serves desktop and mobile) link to `https://app.nuehealth.in/onboarding`. There are no pricing CTAs, no "Book a test" button and no basket on the marketing site.

**Onboarding.** [O] The step list comes from the shipped `NueOnboardingFlow` chunk. I walked steps 1–6 in the browser and stopped at the phone field.

| # | Path | Screen | Seen in browser? |
|---|---|---|---|
| 1 | `/onboarding` | "Welcome to Nue. Let's get started." [Get Started →] on the blurred green grainient | Yes [O1] |
| 2 | `/onboarding/twin` | "Meet your digital twin built from your blood": phone with point-cloud body, a "Cardiovascular A ● Optimal" card, "●● 2 of your biomarkers need attention" | Yes [O2] |
| 3 | `/onboarding/biological-age` | "Discover how your body is really aging": phone with "Biological Age 29 · ↓ 15 years younger" on a blue-sky gradient; "Tasks to complete: View your results 🔒" | Yes [O3] |
| 4 | `/onboarding/organ-systems` | "See how each organ system is performing": the Cardiovascular tab, "Your rank B · In range"; an orange "Concerning · Your organ systems, clearly explained" card; marker rows with range bars | Yes [O4] |
| 5 | `/onboarding/protocol` | "Get a personalised Nue Protocol": Daily supplements grid (Omega-3 500mg, Vitamin D 1000 IU, Boron 1mg, Zinc 15mg, each with "+"), "Why these specifically: Low level of Omega-3, needed for cardiovascular & cognitive function" | Yes [O5] |
| 6 | `/onboarding/phone` | "Enter your phone" (+91), Continue, Terms and Privacy | Yes, nothing typed [O6] |
| 7 | `/onboarding/verify` | OTP | Code only |
| 8–12 | `/name`, `/birthday`, `/gender`, `/body`, `/address` | First and last name and email → DD/MM/YYYY (must be 18+) → "What is your sex?" Male / Female → height (cm or ft/in, 120–230 cm) and weight (kg/lb) → "Where should we collect your blood sample?" with Google Places, "Use current address", a PIN-code coverage check ("We're adding new pin codes every week, and we'll text you the moment yours is covered.") and "This is an at-home blood test". A progress bar covers these five steps; birthday and sex auto-advance. | Code only |
| 13 | `/onboarding/next` | "Complete these steps to finish setting up your account": Become a Nue member · Schedule your blood test · Upload past reports | Code only |
| 14 | `/onboarding/membership` | "Regular blood tests. On a schedule you pick." Your first test sets a baseline / Every test after it shows what changed · We'll send you reminders / Notifications 15 days before each test · Cancel anytime / No lock-in contracts | Code only |
| 15 | `/onboarding/plan` | "Choose your Nue": Core 77 biomarkers ("Recommended for most") vs Advanced 93 ("Fertility, heart & hormones"); promo code field | Code only |
| 16 | `/onboarding/frequency` | "How often would…": Every 3 months / Every 6 months / Once a year, one marked "Recommended"; "Continue to payment" → Razorpay ("Opening payment…") | Code only |
| 17 | `/onboarding/app` | "Get the Nue app" (QR on desktop): Continue in the Nue app to access your results and follow your personalised protocol | Code only |

- [O] **No health quiz before sign-up.** The only questions are demographics (name, email, birthday, sex, height, weight, address). Product education comes first, as four slides, *before* the phone number (the analytics event is labelled `onboarding_flow: "intro_first"`).
- [O] **The app carries the server-driven surveys** (types `single_choice`, `multi_choice`, `statement`, `text`, `number`, `date`): a goals and habits survey ("Your habit is set. Track it for 4 weeks, then your retest shows what changed."), and a post-draw context survey (fasting window, last caffeine, exercise in the last 24 h, sleep the night before, cycle phase, recent illness, vaccine or medication changes). [I] The post-draw survey is how they interpret one-off swings in results.
- [O] **Booking happens after payment, in the app.** The dashboard chunk has a draw-scheduling sheet (date and time slots, "Anything your phlebotomist should know? Gate codes, parking…", 2 h reschedule and 24 h cancel cut-offs, late-fee warnings) and a journey tracker: "Your kit is on the way → Your sample is on its way → Your sample was received by the lab → queued for analysis → being analyzed → Your results are being reviewed → Your results are ready." Also "Days until test", "How to prepare: You must be fasted and hydrated", "Remaining until next test". [I] Parts of the scheduling copy (GetLabs, zip code) belong to the US Sedona variant; the Nue version uses an at-home phlebotomist with a +91 phone and PIN code.
- [O] **The report** opens in the app (tabs: Home/Overview · Results · Twin · Protocol · Profile or Store) and can be downloaded as a PDF (FAQ: "You can download your full results as a PDF or share them directly from the Nue app").

---

## 10. Mobile (390 x 844)

- [O] **Nav:** the same floating pill, holding the logo, a black "Join today" and a hamburger. The menu opens as a full-screen `#F7F7F7` overlay (`mobileOverlayIn` .26 s, links staggered in by `mobileLinkReveal` .52 s). On the homepage it holds only the logo, a grey rounded close button, one row "What we measure ›" over a hairline, and a full-width black "Join today" pill pinned to the bottom. The navbar chunk also contains "How it works", "Membership", social and legal links. [I] Those appear on other pages or in other states. [M2]
- [O] **Hero:** the text moves to the left and sits at the bottom; the photo occupies the top `min(64svh, 560px)` with a 96 px mask fade; the CTA goes full width (max 380 px); the proof points stack. [M1]
- [O] **Scroll film:** the ring is `min(100vw - 8px, …)` and the status labels drop below the dial in a 2-column grid. The CSS hides the 1st and 3rd labels (`:nth-child(1),:nth-child(3){display:none}`), so a phone shows only two: Blood sugar · Improving and Liver health · Needs attention. [M3]
- [O] **Sections** go `height:auto` and stack; phones and cards go full width; the comparison table keeps both columns at 14 px; pricing cards stack and **each floods with its green or purple orb once it is 85% in view** (no hover on touch); the footer radius drops to 24 px. [M4] [M9]
- [O] **`/biomarkers` on a phone:** the floating marker cards are hidden (`._resultCard{display:none}`), leaving the body and the "4 of your signals changed" card. The "By area" sidebar becomes a horizontally scrolling chip row with a 64 px fade on its right edge, and the tables go full width with 16 px padding and narrower check columns. [B3]
- [O] Tap targets stay at 44 px or more; the cookie banner spans the width at the bottom and covers about 35% of the first screen until dismissed. [M1]
- [O] The onboarding app is mobile-first: full-bleed, a 56 px white pill CTA pinned near the bottom, a back pill top left. [O1]–[O6]

---

## 11. Reports and markers (the most important part)

What follows comes from Nue's own app screenshots on the marketing site [A1] [A2] [A3] [A4], the onboarding intro art [O2]–[O5] [A5], the shipped results code, and the sister brand's sample PDF [R1]–[R6].

### 11a. One status vocabulary, three tiers, everywhere
- [O] In code: `{optimal: green1000, in_range: purple1000, out_of_range: red1000, unknown: gray650}`. Labels for Nue: **Optimal / In range / Out of range**. The Sedona build uses softer words for the same states: **Strong / On track / Focus area**.
- [O] Each status has `text`, `bg`, `soft` (10% tint), `line` and `ring` variants. Pills are tinted backgrounds with coloured text, not solid fills: "Optimal" is green on `green-200`, "In range" purple on `purple-200`, "Out of range" red on `red-100`.
- [O] Systems also get **letter grades A / B / C**, mapped to the same green / purple / red ("Your rank B · In range"). [O4]
- [O] **Trend** has its own vocabulary, kept separate from status: Improving (green, up arrow) · Unchanged (purple, dash) · Needs attention or Declining (red, down arrow).

### 11b. The results summary: counts before details [A1]
- [O] A coloured-dot tab row: Overall · ● Metabolic (red) · ● Kidney (green) · ● Cardiovascular (purple)…
- [O] A narrative lead, set at a large size, with the first clause greyed out: "*Looking good, Punarv.* Most markers are where they should be. Your ● Metabolic system is the one quietly pulling the average down." The system name is underlined and carries its status dot.
- [O] It is attributed to a named clinician: an avatar, "Dr Saurav P · Your clinical advisor". The Protocol screen adds a "▶ Listen" audio button. [A2]
- [O] "Your latest test · Clinical · 95 biomarkers": a **black card with three counts** (Optimal 32 · In Range 44 · Out of Range 19) above a **tick strip**, one thin vertical tick per biomarker, coloured green → purple → red in sorted order. Then "View records".

### 11c. The marker row: value, pill, segmented range bar [O4] [A5]
- [O] Each row: marker name (ApoB), status pill (Optimal); a big value (72) with a small grey unit (mg/dL); and on the right a **segmented horizontal bar** (red | purple | green | green) with a thin vertical **value tick**. For HDL 34 mg/dL (Out of range) the bar reads red | red | purple | green and the tick sits in the red segment.
- [O] The range model in code: `OPTIMAL / IN_RANGE / OUT_OF_RANGE` bands, each with min/max that can depend on sex, age range, menstrual phase (follicular, ovulation, luteal, menstruation), pregnancy trimester and postmenopause. There is also a "CONSUMER_SCORE" range type. The detail view shows "Reported" and "Lab range" next to Nue's own bands. The marketing comparison claims "India-specific ranges".
- [O] **History card** (marketing, step 3): name, system, status pill, "170 mg/dL", and a sparkline whose dots are coloured by the status at each draw (purple, purple, then green, green). Seeing the dots change colour is how the page shows improvement. [A3]

### 11d. Systems and the digital twin [A4] [O2]
- [O] "Explore your systems": a dark point-cloud body with organs lit in their status colour (lungs green, heart purple, kidneys red, gut purple). Below it, a system chip row (● Blood, ● Brain, ● Endocrine…) and two cards: "**Blood age 25** · ↑ 2 years older" (purple) and "This system is aging **1.13x faster** than the rest of your body". Other frames show Brain age 17 (6 years younger, green), Endocrine age 31 (8 years older, red), Gut age 23 (Same age), Heart 27, Immune 28 (5 years older, red), Kidney 21.
- [O] Opening view: "You're in good health, Punarv. Your biological age is 19." [Tap to explore]. A legend at top right reads ● Optimal ● In Range ● Out of Range, and "PERSONALIZED ANALYSIS IS BELOW ↓".
- [O] On the web, `/biomarkers` reuses the same idea as a hero: "●●●● 4 of your signals changed since your last blood draw", with frosted cards around the body (HbA1c · Improving, Vit D · Unchanged, hs-CRP · Needs attention). [B1]
- [O] The marketing comparison table lists "10 system health grades", "Biological age" and "Digital twin" as differentiators.

### 11e. Biological age [O3]
- [O] A full-bleed blue-sky gradient with a ring of particles: "Biological Age **29** · ↓ 15 years younger". The FAQ explains that it is "an estimate based on your chronological age and nine blood biomarkers, calculated using the peer-reviewed Levine method… more a tool for tracking changes… than a diagnosis".
- [O] In code there is also peer comparison: "How each system compares with people your age and sex, least healthy first", with a 0 → "Typical" → 100 axis "vs peers" and percentile ordinals (15th, 18th…).

### 11f. Change between draws
- [O] A results card "Since your last draw" → "See what moved", with a 44 px headline number. "Key Insight" pills use a violet-to-black gradient text (`from-insight-violet to-black bg-clip-text`). There is a "What's new" badge, a "Back to latest" link, and a "This seems wrong" or "Remove result" flow ("We'll remove this result while we review it against your report.").

### 11g. The sister report (Sedona sample PDF, 27 pages) [R1]–[R6]
[O] This is the same team's printed report language:
- Alternating black and white A4 pages with a thin top rule and a section label top left; large Neue Montreal headlines; footer with logo, "Proteomic Aging Report" and a page number.
- **Results over time** [R1]: a dark chart where the first test is a ringed value (56) and future tests are **locked grey placeholders with a padlock** ("Next test", "Follow-up"), under a warm card: "This is your first Sedona test. Since you have only completed one test, these graphs are a bit empty…"
- **The system list** [R2]: the body point cloud with organs in colour; a two-column list, each row a status dot plus system name plus a mono right-aligned word (REASSURING / FLAGGED). The legend is one sentence: "Green means the system is reassuring. Purple means the system is flagged with elevated risk." **Red is not used for status.**
- **"What's going well" first** [R3], then "Your aging risks". Cards hold the system name, a mono REASSURING tag, a plain-English paragraph that cites the actual values ("Hemoglobin is 15.9 g/dL, platelets are 259…"), and on the right a percentile chip "↓ 15th · vs peers".
- **Per-system pages** [R4]: a black page with the organ highlighted in the body, a tag (PROTECTIVE or AT RISK · FLAGGED), a narrative, and "Compared with people like you", a **tick-strip distribution** (AGING SLOWER — PEER AVERAGE — AGING FASTER) where the peer band is brighter ticks and "YOU" is a single coloured tick.
- **Evidence** [R5]: "We've flagged 2 of your metabolic system proteins", numbered items with a "Raises signal" pill and numbered citations; "How we reached your result" lists what they know about you as chips (Age 62, BMI 26.4, Strength Training, Rosuvastatin).
- **Protocol** [R6]: "Your Top Priorities" as 01 / 02 / 03, with huge light-grey numerals and concrete instructions.

### 11h. Honesty labels
- [O] Every marketing data visual is labelled illustrative in its alt text: "Illustrative changes between blood tests, not actual patient results", "Illustrative digital twin with example changes since a last blood draw". The footer carries the disclaimer that lab and medical services come from independent third parties. The FAQ says "Nue… is designed to complement your doctor - not replace them" and says that if a marker falls into a critical range "we flag it immediately and reach out to you directly".

---

## 12. Things that look fragile (observed)

- [O] Trial font files (`GT-Standard-…-Trial-*.otf`) ship in production.
- [O] 16 image preloads, including two 3000 px-wide phone screenshots (7.4 MB between them). [I] Most are far below the fold, so they compete with the hero photo (the likely LCP), and mobile performance will suffer.
- [O] The pre-rendered HTML puts the scroll film after the footer, so crawlers and no-JS readers see the page out of order.
- [O] There are two palettes: the warm-brown legal and compare pages (`#2A2321`, `#EAE5DF`) don't match the grey and black main site.
- [O] A stale `/waitlist` page still says "We're launching on July 1".
- [O] The numbers don't line up: the Results screenshot on the site says "Clinical · 95 biomarkers", but the plans are 77 and 93; the counts in that screenshot (32 + 44 + 19) also add up to 95.
- [O] The public app bundle exposes the admin, clinic, study-designer and lab-logistics interfaces as code, plus the other brand's demo data and sample report. [I] Not a leak of user data, but it shows the roadmap and the US sister product.

---

## 13. What D-Human should take, and what to avoid

D-Human is black and white with true `#000` and `#FFF`, Archivo set wide, no accent colour, and only subtle colour grades where they carry meaning. Nue is the closest local reference: a monochrome UI where colour is kept for health status. The specifics:

### Reports and markers: take
1. **A three-word status vocabulary used everywhere.** Pick three states and never vary them, for example *Optimal · In range · Flagged*. Nue's softer Sedona labels (*Strong · On track · Focus area*) show the tone can be warmer than "Out of range". Keep **trend** as a second, separate vocabulary (*Improving · Unchanged · Needs attention*) shown with an arrow or dash glyph, so "in range but getting worse" can be said.
2. **Don't use traffic lights.** Nue's best decision is *not* using amber for "in range". For D-Human, carry the three tiers in **value and texture first, hue second**: Optimal is a filled disc; In range is a hollow ring or a 50% grey; Flagged is an inverted pill with the existing "!" glyph. Then, if any colour is allowed, add *one* low-chroma grade only on the flagged state, as a 10% tint behind the pill. The meaning has to survive in greyscale.
3. **Counts before details.** Copy the summary block: a dark card with three big numbers (Optimal 32 / In range 44 / Flagged 19) over a **tick strip**, one hairline per marker sorted by status. It suits a monochrome brand: the ticks can differ by height or opacity instead of hue, and the D-Human 100-square chart already speaks this language.
4. **The marker row.** Name · status pill · big value with a small grey unit · a **segmented range bar with a value tick**. In black and white, draw the bands as grey steps (for example 20% / 45% / 100% black for flagged / in range / optimal) with a 1 px vertical value tick and a small caret. Always show the lab range as text next to the bar ("Lab range 40–60"), as Nue's detail view does.
5. **A sparkline whose dots change state.** For retests, dots that go hollow → filled tell the improvement story without a legend. Put this on the retest step of the loop.
6. **Narrative first, signed by a doctor.** Lead the report with one or two sentences in plain words ("Most markers are where they should be. Your vitamin D is the one pulling the average down."), with a named doctor and avatar. This fits D-Human's "doctor reviews the results" step better than a dashboard of numbers. Grey out the greeting so the finding reads first.
7. **Locked future points.** On a first report, show the next test as a padlocked placeholder on the timeline ("Retest in 3 months"). It makes the retest loop visible and turns an empty chart into a reason to come back.
8. **"What's going well" before "What to work on".** The Sedona report opens on reassuring systems with the actual values, then the risks. Use the same order, and the same plain-English paragraphs that cite real numbers.
9. **Peer distribution as ticks**, not a bell curve: a row of hairlines, the peer band brighter, a single "YOU" tick. It is monochrome-native, and accurate without needing a fitted curve.
10. **Label illustrative data.** Nue writes "Illustrative…" in alt text; D-Human already does this in visible text, which is better. Keep it.

### Dashboard: take
- Bottom tabs of 4–5 (Home · Results · Protocol · Profile) and one "Tasks to complete" list with locked items until results land.
- A sample journey tracker in plain sentences ("Your sample was received by the lab → being analysed → being reviewed by your doctor → ready"), with "Days until test" and "How to prepare: fasted and hydrated".
- A short post-draw context survey (fasting window, caffeine, exercise, sleep, recent illness, new supplements). It costs little and protects how results are read.

### Onboarding: take
- **Teach, then ask.** Four full-screen slides (twin, biological age, systems, protocol) come *before* the phone number, each one product screenshot plus one line. D-Human could do the same: Test → Doctor reviews → Only what your markers point to → Retest.
- Demographics one per screen, auto-advancing on single choices, a progress bar over that group only, and **a PIN-code coverage check before payment** with a "we'll text you when we reach you" fallback.
- Plan → frequency (3 / 6 / 12 months, one "Recommended") → payment → app. Making frequency its own step frames the product as a subscription to retesting.

### Colour: take and avoid
- **Take:** monochrome chrome with hue kept for meaning; a near-white page (`#F7F7F7`) under white cards to give depth without shadows; alpha-based hairlines (`#FFFFFF1A`, `#0000001A`) instead of fixed greys; one token object shared by CSS and the canvas, so a WebGL scene and the UI can never drift apart.
- **Avoid:** Nue's atmospheric photo gradients (sage, orange, violet, sky blue) and the warm-brown second palette. They are pleasant, but each one is a new accent, and together they dilute the status colours. D-Human's version is grain and contrast on black and white. If one "grade" is allowed, make it a single low-chroma tint used only for flagged states and the retest moment, as described above.
- **Avoid:** two status systems that disagree. The Nue app uses red for "out of range", while the Sedona report uses purple for "flagged". Choose once.

### Motion: take
- **One house curve**, `cubic-bezier(.22,1,.36,1)`, and three duration tiers (about 0.18 s state, about 0.3 s overlays, 0.8 s or more for scene changes). D-Human's Motion setup can adopt these as tokens.
- **Sticky scroll scenes driven by a damped spring** over native scroll (no Lenis), paused offscreen, with a real stacked layout for reduced motion. This matches how D-Human already runs the contour field and phone loop. Their ring of ticks that "builds" from particles and then lights per system is a good model for a D-Human "100 people → your markers" scene. Do it in white ticks on black; status can show as length or brightness.
- **A tactile hover on a flat pill:** a black pill that fades to a grainy paper texture over 0.8 s, with a soft ripple. It fits "white pack, black ink" and pairs with the silk threads, but keep it to one signature hover.
- **The HUD bracket label** (`[ApoB] Heart health` in mono inside a corner-marked box) gives an instrument feel for marker callouts. D-Human could use Archivo with a mono only for the `[tag]`.

### Avoid
- Preloading multi-megabyte screenshots and 16 images on the landing page. D-Human's Lighthouse discipline (load media only near the screen) is better than Nue's here.
- Shipping trial fonts, stale pages (`/waitlist`), and a pre-render that puts sections out of order.
- A digital twin that reads as precise anatomy ("Blood age 25, aging 1.13x faster"). It is compelling, but it implies certainty D-Human's copy rules don't allow (no disease claims; screening, markers and risk only). If D-Human uses a body or system view, keep it at system level with plain-English status, and label it illustrative until it is real.
- Letter grades **and** three statuses **and** organ ages **and** percentiles all on one screen. Nue layers four scoring systems. Pick one primary score per screen.

---

## 14. Screenshot and asset index

All paths are under the session scratchpad. Nothing in this list is in the repo.

**Base:** `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/`

| ID | Path | What it shows |
|---|---|---|
| H1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-003-wdecline.png` | Desktop hero with the frosted nav pill (cookie banner dismissed) |
| H2 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop/d-007-w02.png` | Scroll film, "Understand your results": HUD marker boxes, particle swarm, mono marker rows (cookie banner visible) |
| H3 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-013-w04.png` | Scroll film, "Blood draw 2 / Test again" |
| H4 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-015-w05.png` | Scroll film, final stage: status-coloured arcs with Improving / Unchanged labels |
| H5 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop/d-013-w05.png` | The same final stage at another scroll offset (Inflammation · HS-CRP · Improving) |
| H6 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-019-w07.png` | How it works: tube, Daily protocol tiles, Apo A1 marker card with sparkline |
| H7 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-023-w09.png` | Three phones fanned out: Protocol, Explore your systems, Results |
| H8 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-027-w11.png` | One membership / All of this, sticky left column |
| H9 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-031-w13.png` | Optimise for life, video card mid-expansion |
| H10 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop/d-037-w17.png` | Comparison table on the green photo gradient |
| H11 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-041-w18.png` | Pricing cards, resting state (₹2,999 / ₹6,999) |
| H12 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-043-w19.png` | FAQ |
| H13 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-desktop2/hd-047-w21.png` | Footer with the video-masked NUE wordmark |
| M1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-mobile/m-000-scenario_start.png` | Mobile hero, cookie banner covering the bottom |
| M2 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/menu-mobile/mm-004-openmenu.png` | Mobile menu overlay: one link and a bottom-pinned Join today |
| M3 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-mobile/m-015-w06.png` | Mobile scroll film, final stage, labels below the dial (Liver health · Needs attention) |
| M4 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-mobile/m-023-w10.png` | Mobile, "77 biomarkers" phone with the Results summary |
| M9 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/home-mobile/m-039-w18.png` | Mobile pricing card in the flooded green orb state |
| B1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/biomarkers-desktop/bd-001-settle.png` | `/biomarkers` hero: "4 of your signals changed since your last blood draw", frosted marker cards |
| B2 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/biomarkers-desktop2/bd2-003-w00.png` | `/biomarkers` table: sticky "By area" sidebar, white category header bars, CORE / ADV(M) / ADV(F) check columns |
| B3 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/biomarkers-mobile/bm-003-w00.png` | `/biomarkers` at 390 px: search, scrolling category chips, Metabolic table |
| C1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/compare-desktop/cd-000-scenario_start.png` | `/compare`: counts naming Function Health and Orange Labs, dark Nue column band, tick/cross table |
| W1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/waitlist-desktop/wd-002-decline.png` | Leftover `/waitlist` page (form not filled) |
| D1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/download-desktop/dl-002-decline.png` | `/download`: QR and store badges |
| O1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/onboarding-mobile/om-001-settle.png` | Onboarding welcome on the green grainient (mobile) |
| O2 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/onboarding-mobile/om-003-w_twin.png` | "Meet your digital twin": Cardiovascular A · Optimal, 2 biomarkers need attention |
| O3 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/onboarding-mobile2/om2-005-w_bioage.png` | "Discover how your body is really aging": Biological Age 29, mobile (desktop: `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/onboarding-desktop/od-004-next1.png`) |
| O4 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/onboarding-mobile2/om2-007-w_organs.png` | "See how each organ system is performing": Your rank B, Concerning card, ApoB range bar, mobile (desktop: `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/onboarding-desktop/od-007-w_organs.png`) |
| O5 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/onboarding-mobile/om-009-w_protocol.png` | "Get a personalised Nue Protocol": daily supplements |
| O6 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/shots/onboarding-mobile/om-010-getstarted2.png` | "Enter your phone" (+91), where the walk stopped |
| A1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/assets/product-3-900.png` | App Results screen: narrative, clinician, Optimal 32 / In Range 44 / Out of Range 19 tick strip |
| A2 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/assets/product-1-900.png` | App Protocol screen: narrative, Listen, Non-negotiables |
| A3 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/assets/step-3.png` | Marker history card: Apo A1 · Optimal · 170 mg/dL with status-coloured sparkline |
| A4 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/assets/frames/sheet-p2.png` | 11 frames of the "Explore your systems" twin video: organ ages, "aging 1.13x faster", biological age 19 |
| A5 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/assets/app/intro-3-organ-systems-CMsGHq5r.png` | Full-resolution app art: rank B, ApoB 72 Optimal and HDL 34 Out of range with segmented range bars |
| A6 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/assets/app/intro-2-biological-age-CjW47E7M.png` | Full-resolution biological-age screen with "Tasks to complete" |
| A7 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/assets/organ-systems-crop.png` | Hand-held phone: Explore systems, Cardiovascular age 39 · 15 years younger, "1 of 15 pathways need attention" |
| R1 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/pdf/page-03.png` | Sedona report: results over time with locked future tests |
| R2 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/pdf/page-04.png` | Sedona report: twelve systems, green/purple legend, REASSURING / FLAGGED |
| R3 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/pdf/page-05.png` | Sedona report: "What's going well" cards with percentile chips |
| R4 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/pdf/page-13.png` | Sedona report: flagged system page with peer tick-strip and a YOU marker |
| R5 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/pdf/page-14.png` | Sedona report: flagged proteins with "Raises signal" pills and citations |
| R6 | `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/nuehealth/pdf/page-21.png` | Sedona report: Your Top Priorities 01 / 02 / 03 |

**Contact sheets:** `shots/sheet-hd2-a.png`, `shots/sheet-hd2-b.png` (full desktop scroll), `shots/sheet-mobile-a.png`, `shots/sheet-mobile-b.png` (full mobile scroll), `shots/sheet-onboarding-mobile.png`, `shots/sheet-onboarding-mobile2.png`, `shots/sheet-onboarding-desktop.png`, `shots/sheet-biomarkers-desktop.png`, `shots/sheet-biomarkers-mobile.png`, `shots/sheet-compare.png`, `assets/frames/sheet-p2.png`, `pdf/sheet-1.png`–`sheet-3.png` (all 27 report pages), `assets/sheet-app-intro.png`, all under the base path above.

**Raw evidence:** the HTML, CSS and JS are in `raw/`; the app bundle is in `raw/app/`; the CSS counts are in `raw/cssstats.txt`; the REA scenario inputs and outputs are in `scen/` and `out/`.

### Capture notes and blockers
- Several REA runs returned `cleanup_incomplete` (browser cleanup took more than 30 s), and a few `rea` processes stayed alive after writing their output, so I stopped them by hand. Steps and screenshots were kept in `partial_observation` either way, and every image above comes from steps marked `completed`.
- On `/biomarkers`, the scripted "Decline" click failed because that page shows no cookie banner, so the rest of that run was cancelled; B1 is from before the click. The rerun (B2) scrolled the table, but its scripted click to open a biomarker row timed out, so the expanded row is described from CSS only (a `details` element with a 0.28 s chevron rotation and the description under the name).
- The first mobile onboarding run caught the biological-age and organ-systems slides before their images had loaded. A second run with 6 s waits captured them (O3, O4); the desktop run and the full-resolution app art (A5, A6) cover the same screens.
- No REA scenario action can hover or evaluate script, so hover states (pricing orb flood, button grain) are described from CSS and JS, not screenshots. The mobile capture shows the flooded pricing state because at 768 px or less the cards flood when scrolled into view.

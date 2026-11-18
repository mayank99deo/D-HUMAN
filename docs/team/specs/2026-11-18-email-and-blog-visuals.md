# Email and blog visuals

Graphic designer, 18 November 2026. This is the visual system for D-Human's lifecycle emails and the new blog.

It sits on three specs written the same day:

- `2026-11-18-lifecycle-emails.md` (the UX and retention designer: email content, timing and rules);
- `2026-11-18-blog.md` (the product designer: blog flows and blocks);
- `2026-11-18-blog-and-email-architecture.md` (the backend design).

Those specs own the words, timing and data. This one owns how it all looks. Where I differ from them, section 3 says so, with the reason.

**Mockups.** Static HTML; open them in a browser. They live in the session scratchpad, `/private/tmp/claude-501/-Users-mayanknarayan-D-HUMAN/c4a2d76f-0579-4864-9ecb-814739159e86/scratchpad/gd/`:

- **Emails:** `email-welcome.html`, `email-wraps.html`, `email-quiz.html`. The copy follows the lifecycle spec's picks.
- **Blog:** `blog-index.html`, `blog-post.html` (add `?lang=hi` for a Devanagari hero), and `blog.css`.
- **Share images and covers:** `og-template.html` makes the per-post share image and the cover for posts without a photo.
- **`assets/`:**
  - email wordmarks (PNG plus SVG source);
  - the 10 sport pictograms as stills, in SVG and PNG, plain and outlined;
  - the D mark;
  - graded photos and typographic covers;
  - `grade-compare.jpg`.
- **`og/`:** three rendered share images, plus `satori-devanagari-test.png` (the `next/og` failure in section 2).
- **`shots/`:** screenshots at 390 and 1280 px.
  - `email-*-board.png` shows each email at 390 px in five states: light, Apple-style dark mode, full inversion, partial inversion and images blocked.
  - `pictograms-sheet.png` shows all 10 stills.

The only repo change is this file.

---

## 1. Emails: one system

### Anatomy

Every email has the same five slots:

1. **Masthead, on ink.** The wordmark image only.
2. **Hero, on ink.** One headline (wide 800), one line in graphite.
3. **Band slot.** Exactly one of:
   - **the bib** (welcome);
   - **the week as seven squares** (weekly wrap);
   - **the contour band** (account emails with no personal data, such as the waitlist welcome and "didn't finish setting up");
   - **nothing** (feedback: the question is the content).
4. **Paper card.** Numbers, steps, buttons, quiz options and the D-corner callout.
5. **Footer, on ink.**
   - The reply line, when replies reach an inbox.
   - The stop link for this kind of email and Email settings, each a separate 44 px tap target. Never dot-separated.
   - Why you got this email, the disclaimer, and the postal address.

The 600 px container is centred on a full-width ink table. Phones keep a 12 px ink margin each side, so the card reads as the white pack. Inner padding is 40 px, or 24 px under 620 px. Vertical steps are multiples of 4 px.

### Type

Archivo loads with its width axis in Apple Mail, iOS Mail and Samsung Mail. Gmail and Outlook drop it and use the fallbacks, so every style has to work in Helvetica or Arial. Width is set with `font-stretch` after the `font` shorthand, because the shorthand can't take a percentage.

| Style | Desktop | Under 620 px | Weight | Width in Archivo |
| --- | --- | --- | --- | --- |
| Headline | 48/50 | 36/38 | 800 | 118% |
| Bib number | 128/112 | 96/84 | 800 | 125% |
| Big stat ("4 of 6") | 80/72 | 64/60 | 800 | 125% |
| Protein number ("96 g") | 56/56 | 44/46 | 800 | 125% |
| Small stat ("14", "Poha") | 32/34 | same | 800 | 125% |
| Question | 26/31 | same | 700 | 112% |
| Body | 17/27; 16/24 for secondary text | same | 400 | 100% |
| Label above a rule | 14/20 | same | 700 | 100% |
| Button and option label | 16/20 and 17/22 | same | 700 and 600 | 100% |
| Footer | 13/20 | same | 400 | 100% |

Fonts:

- **Latin stack:** `Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif`.
- **Devanagari** (a Hindi email, or a food title in a wrap): add `'Noto Sans Devanagari', 'Kohinoor Devanagari', 'Devanagari Sangam MN'`. Set line height to 1.3 and letter spacing to 0. Never load Anek Devanagari in email.

### Colour

- **Tokens:** ink `#000`, paper `#fff`, graphite `#8c8c8c` (on ink, 6.25:1), smoke `#5c5c5c` (on paper, 6.69:1), rule `#d4d4d4`, and `#333` for unfilled story-bar segments.
- **One colour:** serum `#B5D2C0`, only on a weekly square where the protein aim was reached, and always with a black check mark. That's progress, the way the app's rings run green, so the glyph carries the meaning.
- **No marker status in email.**

### Dark mode: inversion must never cost a label

The emails declare `color-scheme: light dark` and carry their own dark styles.

| Client | What it does | What the emails do |
| --- | --- | --- |
| Apple Mail, iOS Mail, Outlook for Mac | Applies our `prefers-color-scheme` styles | The card turns `#111` and text turns white (18.9:1), secondary text `#a3a3a3` (7.5:1), quiz borders `#8c8c8c` (5.6:1). The primary button turns white with a black label, as on the site. The bib stays paper, as it does in the dark app |
| Gmail on iOS | Inverts the whole email, dark areas included | The email becomes white with a black card. The wordmark PNG keeps its black tile, so it shows as a black label instead of a white logo vanishing on white |
| Gmail on Android, Outlook.com and apps | Partial inversion: light backgrounds turn dark, dark text turns light, dark backgrounds stay | All text stays readable (13.5:1 in the model). The week strip still reads: checks stay checks, and empty days become outlines |
| Outlook on Windows | No gradients | Corners fall back to square. Low priority for this audience |

**The surface rule, found while testing.** In the partial-inversion model, my first bib used a gradient as its only background. Its text turned light while the white gradient stayed white, so "24", "Priya" and the bib's next step disappeared. Inverters decide by `background-color`. So the rule is:

- every surface keeps a real `background-color`;
- the cut corner is a small triangle painted on top, in the colour of the surface behind it. Example: `background-color:#000; background-image:linear-gradient(135deg,#fff 7px,transparent 7px)`.

The worst case is a 7 px speck at a corner. I verified this in the model; it needs confirming on a device.

**Implementation:**

- **Two style blocks:** phone layout in one `<style>`, dark mode in the other, so a client that rejects one keeps the other.
- **Class selectors only.**
- **Device pass before launch:** Gmail on Android in dark mode, Gmail on iOS and Apple Mail, on real phones or in Litmus.

### Wordmark: an image, not text

The wordmark is a drawing. As live text it would be "D-HUMAN" in Helvetica, and Gmail has no SVG, so both versions are PNGs.

- **Masthead:** `assets/email-wordmark@3x.png`, shown at 192 × 40, 1.9 KB.
  - The white mark sits on an opaque black tile with 12 px of padding. On ink the tile is invisible; in forced inversion it's a black label.
  - The masthead cell is padded 28 px (12 px on phones), so the visible mark lines up with the text.
  - Today's `public/brand/wordmark-white.png` is transparent and vanishes when Gmail on iOS whitens the masthead.
- **Bib:** `assets/email-wordmark-ink@3x.png`, 120 × 18, 1.3 KB. Ink on a paper tile.
- **Alt text:** "D-Human" on both. Each image carries inline font and colour, so the alt text is styled when images are blocked (checked).
- **Sources:** `email-wordmark.svg` and `email-wordmark-ink.svg`, traced from `components/brand/paths.ts`.
- **Proposed repo home:** `public/brand/`, with SVG sources in `public/brand/src/`.

### The bib in email (welcome)

The app's `Bib` (`components/platform/Bib.tsx`) rebuilt as a table, so it reads with images off.

- **Card:** a paper card with the app's 22 px cut corner (a 15 px gradient stop, painted in ink over a white `background-color`).
- **Pin holes:** four 10 px ink circles, square in old Outlook.
- **Top row:** the ink wordmark top left, and the label ("Regular runner", semiwide 600) top right.
- **Middle:** the age as the number (128 px, 96 px on phones), the first name under it (wide 700, written as in the app, not in capitals), and the sport pictogram (80 px) at the bottom right.
- **Tear-off strip:** a 2 px dashed `#a6a6a6` line, then "Next: log your first meal" as a 44 px link.
- **Screen readers:** the number is `aria-hidden`, and the table is labelled "Priya, Regular runner, bib number 24", as in the app.

**Sport pictograms (the lifecycle spec asked me for these).** All 10 archetypes are exported as stills from `components/platform/Emote.tsx`, using the same still frame the app shows when motion is reduced (`STILL` in Emote.tsx). Files are in `assets/pictograms/`:

- **`<sport>.svg` / `<sport>@3x.png`:** ink on paper, 1 to 2 KB.
- **`<sport>-halo.svg` / `<sport>-halo@3x.png`:** transparent, with a 2.5-unit white outline drawn by an SVG dilate filter, about 4 KB. The outline is invisible on the paper bib. If a mail app darkens the bib, it keeps the figure readable, where a white-backed PNG would show as a white square (both seen in the model).
- **Email uses the outlined version.** Alt text is the persona label ("Runner").
- **Re-export:** the export ran through esbuild and React's server renderer. Re-export whenever Emote changes.

### Primary button and links

- **Button:** one link, `display:inline-block`, 16 × 28 px padding, so 52 px tall (the lifecycle spec's height). Full width under 620 px.
- **Colours:** ink on paper, paper on ink, and paper in dark mode.
- **Cut corner:** the 7 px triangle described in the surface rule. It renders the site's 10 px cut (`app/globals.css:147-158`). Without gradients the button is square.
- **Secondary action:** an underlined text link padded to 44 px tall. Never a second filled button.

### The D-corner callout (new)

- **Shape:** a 40 × 4 px bar, a 10 px gap, then a 4 px stem down the left of the text. This is the top-left corner of the D in the wordmark: a top bar, the open notch, then the stem (`components/brand/paths.ts`, the first subpath).
- **Use:** once per email, for the line that matters ("We suggest a supplement only when a marker or a real food gap points to it.").
- **In email:** three table rows. It replaces the plain left rule at `lib/waitlist/welcome-email.ts:116`.

### Weekly wrap: seven squares and stat tiles

- **Seven squares:** 7 columns of 44 px cells with 6 px gutters, and a day letter above each.
  - **Logged:** a paper cell.
  - **Protein aim reached:** a serum cell with a black check mark (U+2713, set in Arial so phones don't swap in an emoji).
  - **Nothing logged:** a 1 px smoke outline (3.14:1), empty, never red.
- **Under the squares:** a two-swatch legend, then the summary in words: "Logged on 6 days. Protein aim reached on 4." The words carry the meaning whatever a client does to the fills.
- **Story bar:** six 2 px segments above the headline, the first one filled, as at the top of a wrap in the app (`components/platform/Wraps.tsx:59-65`). It replaces a capitals "WEEKLY WRAP" label. The date goes under the headline in sentence case ("9 to 15 November").
- **Card:**
  - **Big stat:** "4 of 6", with its label in 700.
  - **Up from:** the "Up from" line in smoke.
  - **Small stats:** two tiles (14 meals logged, Poha most logged). A 2 px rule sits above each, with no boxes, as in the guides' facts list (`components/site/Guide.tsx:77-84`).
  - **Then:** the button.

### Quiz options that work in Gmail on phones

- **Rows:** each option is a full-width table row with a 1 px ink border (21:1). One plain `<a>` fills it as a block. 16 px padding and a 22 px line height make it 56 px tall, and rows are 8 px apart. This is onboarding's square `.choice` chip, translated.
- **Answers:** in the link (`/feedback?t=…&q=feel&a=very`). No forms, no scripts.
- **For the staff engineer:** email security scanners open every link in a message. If `/feedback` saves the answer on GET, a scanner votes for every option. The page should load, show the tapped choice as selected, and save it with a script call, deduplicated per token. The architecture spec should confirm this.

### Size budget

| | HTML | Images |
| --- | --- | --- |
| Gmail clips over | 102 KB | n/a |
| Our ceiling | 40 KB | 60 KB per email |
| Welcome (mock) | 12.7 KB | 7.4 KB (two wordmarks and a pictogram) |
| Weekly (mock) | 11.3 KB | 1.9 KB |
| Feedback (mock) | 6.1 KB | 1.9 KB |
| Contour band, when used | n/a | 28 KB (`public/brand/email-header.jpg`) |

Tracked links will add weight. A test should fail any rendered email over 40 KB.

### Accessibility

- `lang` on `<html>`, and on any food title in another script.
- The headline is a real `<h1>`.
- Layout tables have `role="presentation"`.
- Decorative images have `alt=""`.
- Text contrast is 4.5:1 or better in light mode, Apple dark mode and both inversion models. The lowest is graphite after full inversion, at 4.74:1.
- Every tap target is 44 px or more.
- Every email has a plain-text part.

### Build notes

- **Shared parts in `lib/email/`:** `layout()`, `button()`, `textLink()`, `dCorner()`, `bib()`, `weekSquares()`, `statTiles()`, `choices()` and `footer({ kind })`, with one `EMAIL` token constant.
- **Existing emails:** rebuild the waitlist welcome (`lib/waitlist/welcome-email.ts`) and the sign-in code email (`lib/auth/email.ts:20-27`, which today spells "D-HUMAN" in spaced letters) on the same parts.
- **Preview:** extend the dev-only `/api/email-preview` to render each email in each state.

---

## 2. The blog

The product designer's spec sets the pages and blocks. This section gives them a look, using the guides' system: the 1280 px grid, 20 and 32 px gutters, ink and paper bands, and the subpage header plus "Blog".

### Index

- **Hero (ink):**
  - the breadcrumb;
  - the H1 "The D-Human blog" (semiwide, `--text-title`), with "D-Human" kept whole;
  - the dek in graphite;
  - categories as square `.choice` chips, 44 px tall, with the current one filled. On phones they scroll sideways inside a `relative` scroller.
- **Featured post (ink):** a 3:2 photo, edge to edge on phones. From 1024 px the photo takes columns 1 to 7, with the words on columns 9 to 12 at the photo's foot. The words are the category, the title (28 to 44 px, semiwide 700), the dek and the author chip.
- **List (paper):**
  - **Rules:** a 2 px ink rule above the list, then 1 px rules between rows.
  - **Phone rows:** the category, the title (20 px, semiwide 700) and a dek clamped to 3 lines, with an 88 px square thumbnail on the right. The date and read time sit under the dek, on two lines.
  - **Laptop rows:** the date on columns 1 and 2, the words on 3 to 8, and a 4:3 thumbnail on 10 to 12.
- **End:** "Older posts" as a ghost button, then a Guides strip of text links, then Start free, then the footer.

### Post

- **Hero (ink):** the guide hero's layout (`GuideHero`, `Guide.tsx:53-88`).
  - The breadcrumb, the title at `--text-title` (at most 18 characters a line; 24 for Devanagari) and the dek at 22 px.
  - From 1024 px, a facts list on the right: Written by, Published and Reading time. Updated and Reviewed by appear only when they apply.
  - The facts list is the byline, so dates and read times never become a dotted string.
- **Cover:** it straddles ink and paper, with a background that is ink to 50% and paper after.
  - **Phones:** 3:2, edge to edge.
  - **From 1024 px:** 2:1 across the grid. A 3:2 cover at 1216 px would be 811 px tall and push the first line of the post off a laptop screen.
  - **The crop:** both crops come from the one 3:2 master around the author's focal point.
  - **Caption:** on paper, starting at the reading column.
- **Body (paper):**
  - **Reading column:** columns 4 to 10, at most 66 characters a line, 18/30 from 640 px and 17/28 below.
  - **Contents rail:** from 1024 px a sticky rail on columns 1 to 3 holds "On this page", then Share on WhatsApp and Copy link. On phones it's a closed disclosure, and the share links sit at the end of the post.
- **End matter (ink):** Sources, numbered as in the guides (`Guide.tsx:249-306`); "Written by … Not medical advice. Updated …"; More from the blog as a list with square thumbnails; and Start free.

### The blocks, drawn

| Block | Look |
| --- | --- |
| Heading | H2 at `--text-article-h2` (24 to 32 px, semiwide 700), with `scroll-margin-top` for the sticky header |
| List | 6 px square bullets, as in the guides' `Points` |
| Photo | Square corners, no frame or shadow. Breakouts reach column 12; captions stay in the reading column |
| Pull quote | Semiwide 700 at `--text-pull` (26 to 40 px), a 2 px ink rule above and a 1 px rule below, no quote-mark graphic, breaks out to column 12. `aria-hidden`, because it repeats the text |
| Note | The D-corner, a bold title and the text. A shape, not a box, so it can't be confused with the doctor note |
| Worth showing a doctor | A 1 px ink box and a 28 px ink square with "!" (the house error glyph), the fixed title, `role="note"`. Never colour |
| Key number | The stat tile again: a 2 px rule, the number in `display-num` (56 to 80 px), one line on what it means, and "Source 1" linked to Sources |
| Try it | An ink box inside the paper body, one line, and the white cut-corner button ("Try it in Fuel") |
| Table | The guides' `DataTable` as it is |
| Marker status | The existing `.glyph-*` shapes, always beside a word. On paper the pale grades fall to 1.5 to 2.1:1, so each shape gets a 1.5 px ink outline and keeps its blood fill. That keeps them above 3:1 with no new colours |

Proposed tokens for `@theme`:

- `--text-article-h2: clamp(1.5rem, 1.25rem + 0.9vw, 2rem)`
- `--text-pull: clamp(1.625rem, 1.2rem + 1.6vw, 2.5rem)`
- body at 17 px, then 18 px from 640 px
- `--measure: 66ch`
- a `d-corner` class

### Author chips

- **Avatar:** a 40 px square, 32 px in the post's facts list.
- **Person:** a monochrome photo with the cut corner (6 px at this size), as the product designer asked.
- **Author with no photo:** initials on lift with the cut corner.
- **The team:** the D from the wordmark in white on ink (`assets/d-mark.svg`). The D already carries the notch, so it gets no extra cut.
- **Text:** the name at 15 px, weight 600, with one line under it in graphite.

### Photography

- **Black and white by default** (the product designer's decision 1, which I recommend too). Screenshots and charts keep their colour.
- **The grade:** greyscale, levels stretched between the 1st and 99th percentile, slightly more contrast, gamma 1.1. See the `sharp` call in the scratchpad tools.
- **Subjects:** real Indian food, kitchens, markets, training and labs.
- **No:** stock "wellness" scenes, supplement bottles, or visible brand names and logos. The mock's marathon photo had to be re-cropped to lose sponsor boards.
- **People:** only with a signed release.
- **Credit:** on its own line under the caption: "Photo: name, licence, source."
- **Alt text:** describes the photo. List thumbnails use `alt=""`, because the title link beside them already names the post.

| Use | Ratio | Shown at |
| --- | --- | --- |
| Post cover | 3:2 master | 3:2 edge to edge on phones; 2:1 (1216 × 608) from 1024 px |
| Featured post | 3:2 | 696 × 464 on laptops, edge to edge on phones |
| List thumbnail | 1:1 on phones, 4:3 on laptops | 88 px; 280 × 210 |
| Inline photo | 3:2, 4:3 or 4:5 | Breakout width, 904 px |
| Share image | 1.91:1 | 1200 × 630 |

Mock weights: 70 to 100 KB for a 1600 px 3:2 cover, and 11 to 25 KB for squares. That fits the product designer's 120 KB budget for a cover at 390 px.

### Posts without a photo

The cover is the site's own contour field: the hero shader, drawn once as a still and seeded from the post's slug, so each post's drawing is its own and never changes.

- **Labels:** at 4:3 and larger it carries the category in wide 800. Under 120 px it carries no label.
- **The tool:** the same template makes the share image (`og-template.html?mode=cover&slug=…`).
- **Why not static SVG:** the product designer asked for static SVG. A raster still of the real shader matches the hero exactly. An SVG version would need a separate contour tracer. Either way the drawing is decorative (`alt=""`).

### Hindi and Devanagari titles

- **Font:** pages use the phone's own Devanagari font (Noto Sans Devanagari on Android, Kohinoor on iPhone), not the 726 KB Anek file. This matches the product designer and the landing page.
- **Spacing:** line height 1.3 and letter spacing 0. Negative tracking breaks the headline bar.
- **Measure:** titles get 24 characters a line, not 18.
- **Labels:** categories and other page chrome stay in English. Dates and read times on a Hindi post are in Hindi.
- **Markup:** set `lang="hi"` on the post, title or row.
- **Before publishing:** a native speaker checks the Hindi in the mocks.

### Share images, one per post

- **Size and format:** 1200 × 630, JPEG at quality 82, 41 to 55 KB. The PNGs were 390 KB, because of the field's grain.
- **Layout:** same as `app/opengraph-image.png`:
  - the wordmark at 80/72, 256 px wide;
  - the post's own field on the right, fading to near-black behind the text;
  - the category in graphite at 30 px;
  - the title in Archivo 800 at width 112, bottom-left, at most 3 lines.
- **Title size by length:**
  - Latin: 92 px up to 28 characters, 76 up to 48, 62 up to 72, then 52.
  - Devanagari: 84, 68 or 56, set in Anek Devanagari, which costs nothing here because the image is rendered once.

**`next/og` breaks Hindi (verified).** I rendered a Devanagari title through the `next/og` bundled with Next 16.4 (`@vercel/og` 1.0.1, Satori). Matras came out in the wrong order (कितना became कतिना), halants showed and conjuncts split (क्ष, श्र, द्ध). It also can't use Archivo's width axis. See `og/satori-devanagari-test.png`. Chrome shapes the same text correctly (`og/og-protein-hi.png`).

---

## 3. Where this differs from the other specs, and why

**Lifecycle emails (UX and retention designer).** I followed its content, subjects, preheaders, timing (Monday wraps, feedback on day 10), questions, the bib, the serum check mark and the 52 px button. Five visual points differ:

1. **`light only` → `light dark`, with dark styles.** Gmail ignores the setting either way. Apple Mail users who chose dark mode get a dark card instead of a white slab, matching the app.
2. **A plain rectangle with an optional triangle image → the cut corner drawn in CSS** (section 1, the surface rule). It needs no image, it shows with images off, and its worst case is the same speck an image would leave.
3. **"WEEKLY WRAP · 16 – 22 NOV" → the story bar plus "9 to 15 November" in sentence case.** The brand avoids capitals eyebrows and dotted meta strings.
4. **Footer links separated by middle dots → separate 44 px tap targets.**
5. **The name on the bib in capitals → as written,** matching the app's bib.

**Blog (product designer).** I followed its pages, categories, blocks, 88 px thumbnails, the black-and-white photo rule, the cut-corner author photos and system Devanagari fonts. Four visual points differ:

1. **Laptop index: a 3-column grid of cards → list rows with thumbnails on the right.** Rows scan faster, keep the type-led look, and avoid a grid of identical cards, which the brand rules out. They also load smaller images.
2. **Bylines like "18 Nov 2026 · 6 min read" → a facts list in the post, and two plain lines in lists.**
3. **Cover at 3:2 on laptops → 2:1 on laptops,** from the same master.
4. **Note as a hairline box with an "i" → the D-corner.** It reads as a brand shape and can't be mistaken for the doctor box.

**Architecture (backend design).** Two points need the staff engineer:

1. **Share images through `ImageResponse` will break every Hindi title** (verified above). Two options:
   - **(a) Recommended:** render the share image in the author's browser when they press Publish, and upload it like the photos. The editor already resizes photos in the browser, and a browser shapes Devanagari correctly and can draw the shader field. Drawn on a canvas, the title needs static Archivo instances (SemiExpanded and Expanded ExtraBold; Google Fonts serves them).
   - **(b)** Keep `ImageResponse` for Latin titles, and shape Devanagari titles with HarfBuzz into SVG paths first.
2. **Monochrome by CSS `grayscale` → bake the grade into a second file** in the same browser resize step, and keep the colour original for "keep colour" and any later change of rule.
   - **Main reason, reach:** a CSS filter never reaches share previews, RSS readers or Google Images, so the black-and-white look would break off-site.
   - **Smaller reason, looks:** the grade adds about 10% contrast over plain greyscale on a well-lit photo (standard deviation 49.7 to 54.6, measured; `assets/grade-compare.jpg`). Dim phone photos should gain more (inferred).

---

## 4. Verified and inferred

**Verified here:**

- Every mock rendered in Chrome at 390 and 1280 px with no sideways scroll.
- The emails were captured with images blocked and in `prefers-color-scheme: dark`.
- Two inversion models ran: CSS full inversion, and a script that darkens light backgrounds and lightens dark text and borders. The model caught the bib failure, and the fix was checked in it.
- Every contrast ratio quoted was computed.
- Sizes were measured.
- The Satori and Chrome Devanagari renders were inspected.
- The pictogram stills were rendered from the app's own component.

**Inferred, not tested:**

- Real behaviour in Gmail (Android, iOS), Apple Mail and Outlook: gradient support, how each treats borders and background images, and whether Gmail keeps both style blocks. These need a device or Litmus pass before the first send.

## 5. What I'd do next

1. Build `lib/email/` from the mocks with a 40 KB size test, and move the waitlist and sign-in emails onto it.
2. Run a device pass, starting with Gmail on Android in dark mode.
3. Add the blog tokens, the `d-corner` class, and `Pull`, `Note`, `DoctorNote`, `KeyNumber`, `TryIt` and `AuthorChip` beside `Guide.tsx`.
4. Commission or shoot a first set of 12 to 20 photographs to this brief.

## 6. For Mayank to decide

1. **Email privacy.** My recommendation: food-log counts and the protein aim are fine; blood markers, verdicts and the contour fingerprint never go in email, because email gets forwarded and cached. This agrees with the lifecycle spec's rules.
2. **The postal address in the footer:** which one, or none for now.
3. **Photo sourcing:** our own shoots or licensed stock, not CC BY-SA. Turning a photo black and white adapts it, and BY-SA would then require the same licence and a "changed" note. The mocks use Wikimedia photos for layout only, with credits.
4. **Dark-mode emails:** a dark card in Apple Mail (my recommendation), or always white.
5. **Laptop blog index:** list rows (mine) or a card grid (the product designer's).

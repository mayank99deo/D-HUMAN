# Graphic designer: kickoff review

Checked from the code, screenshots at 390 and 1440 px (demo mode), DOM measurements and contrast maths. Ranked by visible impact.

## Fixes

1. **Home and report pages are wider than the phone (S).** At 390 px the page is 438 px wide, so phones shrink it or pan sideways. The verdict glow (`-inset-x-16`, `Verdict.tsx:27`) causes it. Fix: add `overflow-x-clip` to the wrapper in `app/(platform)/(app)/layout.tsx:21`. `clip` keeps the sticky bib working.

2. **The stack pill looks like a toggle switch (S).** Every item carries the same half-filled pill (`Stack.tsx:107`), which invites a tap. The heading (`text-3xl wide`, line 105) runs to four lines on a phone. Fix: show the item number in `display-num`, as Pointers does, and set the heading in `semiwide` at h2 size.

3. **There is no type scale (M).** Screens use 14 arbitrary sizes, and `--text-title` is never used. Sign-in and onboarding headlines run at 1.55 line height, because `headline` sets none. Fix: add `--text-h1: clamp(2.25rem, 1.6rem + 2.6vw, 3.5rem)` (line height 1.02), `--text-h2: 1.5rem` and `--text-sm-plus: 0.9375rem`. They replace 8 page-title clamps and 19 copies of `text-2xl font-bold semiwide`. Add `line-height: 1` to `headline`, and swap the 14 hard-coded blood `rgb()` washes for `color-mix()` on the tokens.

4. **Some status relies on colour, and some text is faint (S).**
   - Every contour status is a dot, and edge and in-range differ by only 1.09:1 in lightness.
   - Contour labels are about 8 px on a phone.
   - In the orbit, "Tap for another" is 3.4:1 (`Orbit.tsx:105`) and the next steps are 2.2:1 (line 126).

   Fix: draw the `.glyph-*` shapes in `Contour.tsx:115-127`, set labels to 14 units, and use plain graphite in the orbit, not opacity.

5. **The fuel ring misreads (S).** In `FuelLogger.tsx:57-68, 228-253`:
   - "3,500" touches the ring at 1440 px.
   - The fat arc is 1.7:1 against the track (3:1 needed).
   - Fibre shares protein's swatch.
   - 189% of target looks the same as 100%.

   Fix: set arc opacities to 1, 0.7 and 0.42 with 2 px gaps, add a target notch and an "over by 1,650" line, make the number `text-3xl`, and draw the fibre swatch as a dash.

6. **The bib and tab bar are out of line (S).**
   - The bib's rows start at 29, 25, 25 and 40 px (`Bib.tsx:56,61,71`). Use one `--bib-pad` on all four.
   - "Upload" sits 6 px below the other tab labels (`Nav.tsx:85`). Give every icon an `h-9 w-9` slot.
   - The Fuel icon is a clock, which reads as "history". Redraw it as a bowl.

7. **Hindi reads fall back to a system font (S).** Archivo has no Devanagari. Fix: load Anek Devanagari with `next/font` (its width axis also reaches 125) and add it to `--font-sans` after Archivo.

## Missing assets

8. **Share cards and empty states (M–L).**
   - Wraps play like stories but can't leave the app, and the bib can't be exported. Fix: add `next/og` `ImageResponse` routes for a bib card (1080×1350) and a wrap story (1080×1920), with no marker values by default.
   - Upload, Fuel inputs and the five identical Wraps boxes are bare text in boxes. Fix: draw four icons on the nav's 24 px grid (`components/brand/icons.tsx`), add a dashed "ghost contour" to home before the first report, and add a strip of logged days to each wrap card.

Also: at bib size the strength, yoga, walking and "not much yet" figures read as plain sticks; each needs a signature pose (M).

## Needs Mayank

What goes on a share card: the bib number is the person's age, and the verdict is health information.

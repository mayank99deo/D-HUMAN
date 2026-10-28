# D-Human product intro: spec

GOAL:    A viewer understands D-Human in one watch: your lab report becomes a stack of supplements chosen only from your markers. They remember "for the human" and dhuman.fit.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, silent (under 15 s; music offered, not added)
TIME:    13.0 s x 30 = 390 frames

LOOK:    The site's own world. Ground: true black #000000 with the D-Human contour field (the site's WebGL shader, white isolines at 12-40% alpha, focus at 62% x / 50% y), plus a left scrim #000 -> 0% across 0-58% of the width behind the titles.
         Paper and screen: #FFFFFF with ink #000000 ("white pack, black ink"). Secondary ink: #8C8C8C on black, #5C5C5C on white. Rules and rails: #D4D4D4 / #E6E6E6. In-range band #9A9A9A.
         No accent colour (brand rule). Emphasis is inversion: a black block with white type.
         Display: Archivo variable, wdth 118, wght 760, 76 px, line-height 1.0, tracking -0.01em (7% of frame height), balanced wrapping; the opening line sits on one line in an 800 px column. Quiet line: Archivo wdth 100, wght 450, 34 px, #8C8C8C.
         In-app type: headers Archivo wdth 112 wght 760 40-44 px; body wght 650 28-30 px; every reading line at least 28 px (2.6% of 1080, the check's phone floor).
         Medium: product UI on a flat phone (no tilt), a paper lab report, an ink stamp. Phone body #000, rim 3 px #2E2E2E with a 1 px #4A4A4A outer line, corner radius 66 px, screen radius 52 px, a 118 x 34 px island.
         Light and depth: none added. No glow, no shadows on black, no grain beyond the field's own 5%.

OBJECTS: Lab report sheet: 760 x 960 px paper, D-Human wordmark, "Your lab results", "Sample report. Values are illustrative.", five marker rows (name, status, rail with an in-range band and a black value dot).
         Ink stamp: "Reviewed by a doctor", 4 px black border, rotated -7 deg, presses on.
         Phone: 468 x 968 px, screen 440 x 940 px at x 1276, y 70.
         Touch: the iOS "Show Touches" disc (registry touch-indicator spec): 79 px, rgba(0,0,0,0.22) fill, 1 px rgba(0,0,0,0.45) edge, 0.067 s touch-down, 0.12 s dwell, 0.2 s lift. Never hovers or travels.
         Wordmark: the traced D-Human logo, never redrawn.

MOTION:  Arrivals expo.out 0.45-0.6 s; moves and morphs power2.inOut 0.45-0.65 s; exits power3.in 0.25-0.45 s (about half their entrance).
         Fast moves carry blur on their own ease: 10-14 px on full objects, 6 px on rows.
         Titles: the whole line blurs in, 8 px -> 0 and opacity 0 -> 1 in 0.18 s; lands and holds dead still; leaves with a 0.15 s blur-out.
         Lists: 0.08 s stagger. Screen changes inside the phone: blur swap (out 0.15 s, in 0.2 s), the white screen never cuts.

SHOTS:
 1. 0.00-2.20  (f0-66)    The report. Paper sheet at right, rows' value dots slide to their readings (0.2-1.1 s), stamp presses at 1.25 s, the three out-of-range statuses invert to black at 1.55-1.95 s. Title "Your report is in" (0.05-2.2) + "Reviewed by a doctor" (0.45-2.2). Hands off: the sheet slides left to make room.
 2. 2.20-3.70  (f66-111)  The pull. Sheet moves left 420 px (2.2-2.65), the phone enters from the right (2.35-2.95), the three flagged rows lift off the paper and carry into the app's list, shrinking 1.6 -> 1 (2.8-3.61), the sheet leaves left (2.9-3.35). Rows land at 3.65.
 3. 3.30-5.30  (f99-159)  On the phone. Title "Your markers, on your phone" (3.3-5.3). App: "Your markers", "3 to act on, from your lab report", three rows.
 4. 5.28-7.00  (f158-210) The answers. Blur swap to "What do you train for?" (5.28-5.63, in step with the title change) with the site's real options. Touch-downs: Running 5.867, Hyrox 6.367, "Build my stack" 6.967 (each 2 frames after its disc appears); each chip inverts on the touch-down frame. Title "A few small answers" (5.5-7.42). The last tap sends a ripple through the field from the button.
 5. 6.97-10.00 (f209-300) The stack (payoff, 57-77%). The button's black block morphs up into the header band (6.967-7.32); three items land 7.4 / 7.7 / 8.0: Vitamin D3 with K2 (for low vitamin D), Magnesium bisglycinate (for high evening cortisol), Omega-3, EPA and DHA (for raised hsCRP); then "No test result, no pitch." and "Retest in 3-4 months" (8.45). Title "Only what your markers point to" (7.45-10.1).
 6. 10.00-10.60 (f300-318) Object becomes the world: the phone's white screen grows past the frame (scale 4.6, power2.inOut 0.6 s; covers the frame by 10.45), its contents fade, the title blurs out.
 7. 10.55-13.00 (f316-390) End card on white, the pack: wordmark (29% of frame width) wipes in left to right (10.6-11.1, power3.out), "For the human" 64 px inks from #D4D4D4 to #000 (10.85), "Join the waitlist at dhuman.fit" 40 px (10.97). Holds to 13.0 (last line 2.03 s).

BANNED:  a black void with small UI floating in it; glow, bloom, particles; purple or blue gradients, glass cards; cream paper with a serif and mono caps labels; pill chips; everything centred before the end card; every element fading and sliding up; text moving while read; a phone tilted in 3D or idly floating; click rings; the logo docked in a corner; three cards in a row; invented brand names, prices or claims; numbers that aren't marked illustrative; "unlock", "seamless", "effortless".

QA:      f0 (not empty: sheet and rows on screen); 1.0 s (title on one line); 1.4 s (stamp landed); 2.1 s (three flags black); 3.15 s (rows mid-carry, blurred at the fastest frame); 3.85 s (rows inside the app, aligned); 5.9 s and 6.4 s (disc on the chip centre, chip inverted on the same frame); 7.15 s (morph mid-way); 8.9 s (full stack readable); 10.45 s (white covers the frame); 12.75 s (end card holds, nothing moving).

COPY SOURCES: dhuman.fit and the pitch deck. "Doctor-reviewed report", the five markers and the three stack categories with their reasons come from the deck's marker-to-supplement logic; training options are the site's own follow-up question; "No test result, no pitch." and "Retest in 3-4 months" are on the site. The app does not exist yet: its screens are built from the launch page's components and copy, and the report is labelled illustrative, as the site labels its sample report.

# D-Human "Test first" phone loop: spec

GOAL:    Inside the phone on the landing page, a visitor sees what D-Human does in one pass: tests at home, a doctor-reviewed report read in plain words, a stack chosen only from out-of-range markers and only from clean-label brands, then a retest that resets the stack.
OUTPUT:  HyperFrames, 600 x 1296 (the phone screen, shown at about 300 CSS px wide, so 2x), 30 fps, silent, plays as a muted autoplay loop.
TIME:    20.0 s x 30 = 600 frames. The last frame matches the first, so the loop has no seam.

CHAPTERS (the page's four steps follow these; keep them in sync with components/site/LoopPhone.tsx):
 Test    0.00-3.65   "Your tests": Blood, Urine, Gut flip from Booked to Collected/Received; "At the lab" rail fills; a black notification "Your report is in / Reviewed by a doctor" drops and is tapped.
 Read    3.65-9.80   "Your report": five marker rows, dots slide to their readings, three flags invert, "3 to act on.", the "Reviewed by a doctor" stamp presses. Tap Vitamin D: the detail (14 ng/mL, range 30-100, Finding / Candidate / Guardrail), as the site's old sample report card.
 Stack   9.80-15.80  "What do you train for?": Running, Hyrox, "Build my stack". The button's block grows into the header band: three items, each with its reason; "Every brand clears the clean-label bar" with four checks; "No test result, no pitch."
 Retest  15.80-20.00 "Your retest": the three flagged rows, ghost dots at the old readings, live dots move; two land in range, hsCRP stays raised; "New results reset the stack". Then the first screen returns.

STILLS (for the poster and reduced motion): 0.0 (poster), 3.2, 9.3, 15.2, 19.0.

LOOK:    White screen #FFFFFF, ink #000000, secondary #5C5C5C, rules #D4D4D4/#E6E6E6, in-range band #9A9A9A. No accent colour; emphasis is inversion. Archivo variable: headers wdth 112 wght 760 52 px; body 32 px; nothing under 30 px.
MOTION:  Screen changes are blur swaps (out 0.15 s, in 0.2 s); the white never cuts. Arrivals expo.out 0.45-0.7 s, moves power2.inOut. Touches: the iOS "Show Touches" disc, touch-down two frames after it appears.
COPY:    From the site and the pitch deck. The report says "Sample. Values are illustrative." No brand names, prices or disease claims.

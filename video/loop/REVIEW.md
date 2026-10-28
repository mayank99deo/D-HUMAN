# Review: "Test first" phone loop (20.0 s, 600 x 1296, 30 fps, silent)

## Creative calls

- **What it is:** the screen of the phone in the landing page's "Test first. Supplement second." section. It plays as a muted loop beside the four steps, which follow its chapters (Test 0, Read 3.65, Stack 9.8, Retest 15.8 s) and jump to them when tapped.
- **Story:** tests collected at home, the lab, a doctor-reviewed report, one marker read in plain words (the site's old sample report card, moved into the app), a few answers, the stack with a reason per item, the clean-label bar, then a retest where two of three flags clear and the stack resets.
- **Honesty:** the app doesn't exist yet. Its screens use the site's copy and the pitch deck's marker-to-supplement logic; the report says "Sample. Values are illustrative."; no brand names, prices or disease claims.
- **Loop:** the last half second returns to the first screen as it is at 0 s; frame 0 and the last frame match (PSNR 83 dB), so the loop has no seam.
- **The tab bar** inside the app (Tests, Report, Stack, Retest) mirrors the page's four steps.

## Measured

- `check`: no errors. Kept on purpose: `line_unread` (the closing lines continue at frame 0 when it loops), `film_silent` (a muted page loop), `composition_file_too_large` and `timeline_track_too_dense` (one continuous take), `duplicate_media_discovery_risk` (the wordmark on several screens).
- Snapshots checked at 0, 2.5, 3.2, 5.6, 9.3, 10.9, 13.0, 15.2, 19.0 and 19.97 s.

## Shipping it to the site

```bash
npm run render -- --output renders/loop.mp4 --crf 18
ffmpeg -i renders/loop.mp4 -an -c:v libx264 -preset veryslow -tune animation -crf 26 -profile:v high \
  -pix_fmt yuv420p -g 60 -keyint_min 30 -movflags +faststart ../../public/media/loop/how-it-works.mp4
```

Then refresh the stills in `public/media/loop/` (poster at 0 s; test 3.2, read 9.3, stack 15.2, retest 19.0 s) as 600 x 1296 WebP, and keep the chapter starts in `components/site/LoopPhone.tsx` in step with any timing change.

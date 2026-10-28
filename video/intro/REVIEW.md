# Review: D-Human product intro (13.0 s, 1920 x 1080, 30 fps, silent)

## Creative calls

- **Storyline:** the person's own: the report is done, the phone pulls in the data, a few small answers, then the stack, "for the human". One continuous take (the report's flagged rows physically carry into the app), so no alternative storylines were pitched.
- **World:** the site's real contour field (its WebGL shader, unchanged) is the ground; paper and the phone screen are white with black ink. The end card is the white "pack" the phone's screen grows into.
- **Honesty:** the app doesn't exist yet. Its screens are built from the launch page's components and copy (the sample-report row, the follow-up question and its options, "No test result, no pitch.", "Retest in 3-4 months"). The report is labelled "Sample report. Values are illustrative." as the site labels its own. The stack categories and their reasons are the pitch deck's marker-to-supplement logic; no brand names, prices or disease claims.
- **Touches:** the registry's touch-indicator spec (iOS "Show Touches" disc, touch-down two frames after it appears, target responds on that frame). The component itself registers under one fixed id, so it can run once per page; three taps needed it inline.
- **Silent:** under 15 s and not asked for. Music and tap sounds are an easy add.

## Measured

- `check`: no errors. Kept on purpose: `line_unread` on the morph's "Build my stack" label (it continues the button label that was on screen from 5.4 s), `composition_file_too_large` and `timeline_track_too_dense` on the stage (one continuous take so rows can carry across), `duplicate_media_discovery_risk` (the same wordmark used on the report and in the app), `audio_none`.
- Fixed from the first pass: 18 reading lines raised from 26 to 28 px; the closing line now holds 2.03 s; the in-phone swap moved to change with its title; the opening line no longer wraps.
- Snapshots checked at every QA time in SPEC.md, plus the seam into the end card (white covers the frame by 10.45 s; the cut at 10.55 s is invisible) and the 360 px phone sheet (CTA raised to 40 px for it).
- Taps cropped at full size: each disc centred on its chip and the button, chip inverted on the same frame.

## Not checked

- Nothing was heard (there is no sound).
- The field renders through WebGL in the render browser; preview and snapshots matched, the final MP4 was looked at frame by frame only at the sampled times.

## Weakest shot

2.3-3.3 s: after the opening title leaves, the left half is empty for about a second while the sheet shifts and the phone arrives. With more time: carry the title out with the sheet's move instead of blurring it off, or start "Your markers, on your phone" as the rows land.

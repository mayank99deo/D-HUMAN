# D-Human landing page

The waitlist site for D-Human: "Your body speaks data. Hear it. Use it. Own it."

Next.js 16 (App Router), Tailwind CSS 4, a hand-written WebGL background, Google Sheets for signups, and Resend for email.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:3000
```

The page works without any keys. Joining the waitlist then shows an error until the Google Sheet is connected, and emails are skipped until Resend is set up.

## How a signup flows

1. Someone enters their email. The browser posts to `/api/waitlist`.
2. The API checks the email, drops bots (hidden honeypot field, 5 tries per minute per IP), and sends the row to the Google Apps Script web app.
3. The script appends a row to the `Waitlist` tab, or replies `exists` if the email is already there.
4. For a new signup, the API returns right away. Afterwards, Resend sends the welcome email and adds the person to Resend Contacts.
5. The page then asks a few optional questions: plan, training, first name, city, WhatsApp. They go to `/api/waitlist/details` with a signed token, so a visitor can only edit the row they just created.

## 1. Connect the Google Sheet

1. Create a Google Sheet (any name).
2. In it, open **Extensions → Apps Script**. Replace the contents of `Code.gs` with [`google-apps-script/Code.gs`](google-apps-script/Code.gs).
3. Generate a secret: `openssl rand -hex 32`.
4. In Apps Script, open **Project Settings → Script properties** and add `WEBHOOK_SECRET` with that value.
5. Back in the editor, choose **setup** in the function menu and click **Run**. It creates the `Waitlist` tab with its 13 columns, formats it, and confirms in the Execution log that the secret is set. It never deletes data, so it's safe to run again.
6. Click **Deploy → New deployment**, choose type **Web app**, set *Execute as: Me* and *Who has access: Anyone*. Authorize when asked.
7. Copy the web app URL (ends in `/exec`). Opening it in a browser should show `{"ok":true,"service":"d-human-waitlist"}`.
8. In `.env.local`, set:
   - `GOOGLE_SHEETS_WEBHOOK_URL` to the `/exec` URL
   - `GOOGLE_SHEETS_WEBHOOK_SECRET` to the same secret

If you skip `setup`, the tab and header row are created on the first signup, just without the formatting. Values that would run as spreadsheet formulas, and numbers with leading zeros, are stored as plain text.

> If you edit the script later, deploy a new version (**Manage deployments → Edit → New version**). Otherwise the URL keeps running the old code.

## 2. Connect Resend

1. Create an API key at resend.com and set it as `RESEND_API_KEY`.
2. Verify your sending domain (e.g. `dhuman.fit`) under **Domains**, then set `RESEND_FROM`, for example `D-Human <hello@dhuman.fit>`.
   Until a domain is verified, Resend only delivers from `onboarding@resend.dev` to the email address on your Resend account. That is fine for testing, but not for real signups.
3. Optional: create a segment (e.g. "Waitlist") and set `RESEND_SEGMENT_ID`. Every new signup joins it.
4. Optional: set `RESEND_REPLY_TO` so replies to the welcome email reach you. The email then invites replies.

**Emailing the waitlist later:** in Resend, open **Broadcasts**, pick the segment (or all contacts), write the email and send. Resend adds unsubscribe links and honors them. Check resend.com/pricing for the free tier's current daily and monthly limits before a big send.

## 3. Deploy

Any Node host works. On Vercel: import the repo, add the variables from `.env.example` (with `NEXT_PUBLIC_SITE_URL` set to the live URL), and deploy. Share previews use `app/opengraph-image.png`.

## Project map

| Path | What it is |
| --- | --- |
| `app/page.tsx` | The page, assembled from `components/site/*` |
| `components/signal-field/` | The WebGL contour background. It pauses off-screen, lowers resolution on slow devices, and shows a still frame when the visitor prefers reduced motion |
| `components/waitlist/` | The waitlist form and the signup state shared by both forms on the page |
| `app/api/waitlist/` | Signup and follow-up answer endpoints |
| `lib/waitlist/` | Validation, Sheets client, Resend emails, signed tokens, rate limit |
| `google-apps-script/Code.gs` | The Sheets webhook |
| `components/brand/paths.ts` | The D-Human wordmark, traced from the logo artwork |

## Copy rules

The page follows the pitch deck's claims language. It makes no disease claims and says "screening", "markers" and "risk". It uses only sourced numbers (the vitamin D figure is from Tata 1mg Labs, 2023). Plan prices stay off the page until partner pricing is confirmed.

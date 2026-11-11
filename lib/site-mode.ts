// Which landing page "/" shows. Read it from here, nowhere else.
//
//   NEXT_PUBLIC_SITE_MODE=waitlist   the waitlist page, word for word as it was
//   anything else, or unset          "open": people start free and sign in
//
// It is a NEXT_PUBLIC_ variable so server and client components agree. Next
// bakes its value into the build, so changing it does nothing to a site that
// is already deployed: change the variable in Vercel (Project → Settings →
// Environment Variables), then redeploy. Locally, set it in .env.local and
// restart the dev server.
//
// Only the landing page changes. The signed-in platform (/signin, /home and
// the rest) ignores the mode, so existing users keep their links either way.
// Every waitlist component and API route stays in place for waitlist mode.

export type SiteMode = "open" | "waitlist";

// Referenced directly (not through a variable) so Next can inline it.
export const SITE_MODE: SiteMode =
  process.env.NEXT_PUBLIC_SITE_MODE?.trim().toLowerCase() === "waitlist" ? "waitlist" : "open";

export const isWaitlist = SITE_MODE === "waitlist";

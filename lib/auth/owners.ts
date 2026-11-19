// The blog's writers: BLOG_OWNER_EMAILS, comma-separated. Pure, so the email jobs can
// leave writers out without loading the session code (lib/auth/author.ts re-exports these).

/** The owner list, lowercased; an unset or empty variable means nobody may write. */
export function ownerEmails(raw = process.env.BLOG_OWNER_EMAILS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
}

export const isOwnerEmail = (email: string, raw?: string) => ownerEmails(raw).has(email.trim().toLowerCase());

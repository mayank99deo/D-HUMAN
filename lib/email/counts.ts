import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, schema, type Db } from "@/lib/db";
import { utcDay } from "./budget";

// Emails that use Resend's daily 100 but sit outside the lifecycle ledger and sign-in
// codes: counted per UTC day so the budget (lib/email/budget.ts) sees them. Counts only.

export const OTHER_STREAMS = ["waitlist_welcome", "founder_alert"] as const;
export type OtherStream = (typeof OTHER_STREAMS)[number];

const counts = schema.emailDailyCounts;

/** Adds `n` sends to today's count for `stream`. Counted before sending, so a failed send over-counts slightly (the safe side). */
export async function countOtherSend(stream: OtherStream, n = 1, now = new Date()): Promise<void> {
  const d = await db();
  await d
    .insert(counts)
    .values({ day: utcDay(now), stream, sent: n })
    .onConflictDoUpdate({ target: [counts.day, counts.stream], set: { sent: sql`${counts.sent} + ${n}` } });
}

/** Today's total across every stream. */
export async function otherSentToday(d: Db, now = new Date()): Promise<number> {
  const [row] = await d
    .select({ n: sql<number>`coalesce(sum(${counts.sent}), 0)::int` })
    .from(counts)
    .where(eq(counts.day, utcDay(now)));
  return Number(row?.n ?? 0);
}

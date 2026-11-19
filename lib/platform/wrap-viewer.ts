import "server-only";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays } from "@/lib/domain/periods";

// What the wrap viewer needs beyond the wraps themselves (lib/platform/wraps.ts): the
// days of a week with meals, for the "Wrapping…" screen, and when someone reached a
// story's last card.

/** For each of the 7 days from `start` (a Monday), whether any meal was logged. */
export async function loggedDays(userId: string, start: string): Promise<boolean[]> {
  const end = addDays(start, 6);
  const d = await db();
  const rows = await d
    .selectDistinct({ day: schema.foodLogs.localDate })
    .from(schema.foodLogs)
    .where(and(eq(schema.foodLogs.userId, userId), gte(schema.foodLogs.localDate, start), lte(schema.foodLogs.localDate, end)));
  const days = new Set(rows.map((r) => r.day));
  return Array.from({ length: 7 }, (_, i) => days.has(addDays(start, i)));
}

/**
 * Records the first time this person reached the last card ("One thing") of their own
 * wrap. Later views keep the first time. True when this call recorded it.
 */
export async function markWrapFinished(userId: string, wrapId: string, now = new Date()): Promise<boolean> {
  const d = await db();
  const rows = await d
    .update(schema.wraps)
    .set({ finishedAt: now })
    .where(and(eq(schema.wraps.id, wrapId), eq(schema.wraps.userId, userId), isNull(schema.wraps.finishedAt)))
    .returning({ id: schema.wraps.id });
  return rows.length > 0;
}

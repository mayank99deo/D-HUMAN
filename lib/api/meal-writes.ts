import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { FoodLog, Profile } from "@/lib/db/schema";
import { HISTORY_DAYS } from "@/lib/domain/meals";
import { addDays } from "@/lib/domain/periods";
import type { Refusal } from "@/lib/domain/plan";
import { mealDay, mealIdFor, type MealKind } from "@/lib/platform/food";
import { claimUseIn } from "@/lib/platform/plan";
import { localDate } from "@/lib/platform/profile";

// Meal writes only the apps make (the mobile repo's docs/API.md §3.4). The web has no Log
// again and no slot change, and never imports this file.

/** How far back a queued meal may be logged for the day it was eaten, and how far ahead a phone's clock may run. */
export const EATEN_AT_MAX_AGE_MS = 48 * 60 * 60_000;
export const EATEN_AT_MAX_AHEAD_MS = 5 * 60_000;

/** A queued meal's eatenAt, if it's in reach: at most 48 hours old and 5 minutes ahead. */
export function eatenAtInReach(at: Date, now = Date.now()): boolean {
  return now - at.getTime() <= EATEN_AT_MAX_AGE_MS && at.getTime() - now <= EATEN_AT_MAX_AHEAD_MS;
}

/**
 * The meal a try's key already logged, if any. Looked up before anything else about a resend, so
 * a queued meal sent again after its 48 hours (or after the plan's limit) answers as its first
 * send did, with that meal, instead of being judged afresh (QA's review, finding 3).
 */
export async function mealForKey(userId: string, key: string): Promise<FoodLog | null> {
  const d = await db();
  const [row] = await d.select().from(schema.foodLogs).where(and(eq(schema.foodLogs.id, mealIdFor(userId, key)), eq(schema.foodLogs.userId, userId))).limit(1);
  return row ?? null;
}

export type Again = { log: FoodLog; repeat: boolean } | { notFound: true } | { refusal: Refusal };

/**
 * "Log again": a new meal copied from one of the person's own meals in the last HISTORY_DAYS
 * days: the same title, items, numbers, micronutrients and tip, with no AI call. It counts as a
 * meal log like any other (Mayank, 2026-11-26), on the day it was eaten. The new meal's id
 * comes from the try's key (mealIdFor), and the claim and the copy are one transaction under
 * the person's plan lock, so sending the same try again, even in parallel, makes one meal and
 * one use, and answers with that meal.
 */
export async function logAgain(
  userId: string,
  profile: Profile,
  sourceId: string,
  o: { key: string; eatenAt?: Date; meal?: MealKind },
  now = new Date(),
): Promise<Again> {
  const d = await db();
  const id = mealIdFor(userId, o.key);
  const mine = (row: FoodLog | undefined) => (row && row.userId === userId ? row : undefined);
  const [had] = await d.select().from(schema.foodLogs).where(and(eq(schema.foodLogs.id, id), eq(schema.foodLogs.userId, userId))).limit(1);
  if (had) return { log: had, repeat: true };
  const today = localDate(profile.timezone, now);
  const [source] = await d
    .select()
    .from(schema.foodLogs)
    .where(and(eq(schema.foodLogs.id, sourceId), eq(schema.foodLogs.userId, userId), gte(schema.foodLogs.localDate, addDays(today, -HISTORY_DAYS))))
    .limit(1);
  if (!source) return { notFound: true };
  const day = mealDay(profile.timezone, o, now);
  return d.transaction(async (tx) => {
    const refusal = await claimUseIn(tx, userId, "meal", id, day);
    if (refusal) return { refusal };
    const [log] = await tx
      .insert(schema.foodLogs)
      .values({
        id,
        userId,
        localDate: day,
        meal: o.meal ?? source.meal,
        source: source.source,
        inputText: source.inputText,
        title: source.title,
        items: source.items,
        kcal: source.kcal,
        proteinG: source.proteinG,
        carbsG: source.carbsG,
        fatG: source.fatG,
        fibreG: source.fibreG,
        micros: source.micros,
        confidence: source.confidence,
        model: source.model,
        repeatOf: source.id,
        ...(o.eatenAt ? { eatenAt: o.eatenAt } : {}),
      })
      .onConflictDoNothing({ target: schema.foodLogs.id })
      .returning();
    if (log) return { log, repeat: false };
    // The same try, sent again, got there first (under the same lock): that meal is this one.
    const [first] = await tx.select().from(schema.foodLogs).where(eq(schema.foodLogs.id, id)).limit(1);
    const row = mine(first);
    if (!row) throw new Error("[food] a meal with this id belongs to someone else");
    return { log: row, repeat: true };
  });
}

/** Moves one of the person's own meals to another slot. Null when it's gone or someone else's. */
export async function changeSlot(userId: string, id: string, meal: MealKind): Promise<FoodLog | null> {
  const d = await db();
  const [log] = await d
    .update(schema.foodLogs)
    .set({ meal })
    .where(and(eq(schema.foodLogs.id, id), eq(schema.foodLogs.userId, userId)))
    .returning();
  return log ?? null;
}

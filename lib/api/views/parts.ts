import "server-only";
import type { FoodLog } from "@/lib/db/schema";
import { langTag, scriptLanguage } from "@/lib/domain/speech";
import { clockTime, eatenAtOf, mealView } from "@/lib/platform/food";
import type { PlanDetail } from "@/lib/platform/plan-state";

// Pieces several of the apps' answers share (lib/api/schemas.ts MealJson, PlanJson). Only the
// app routes import lib/api/views: the web never does, so nothing here can change a page.

/**
 * A logged meal as the apps get it: the web's MealView (the same words and numbers, never the
 * row), plus when it was eaten on the person's clock and as ISO, and the language its title
 * and tip are written in (the reply language, else the title's script).
 */
export function mealJson(l: FoodLog, tz: string | null | undefined) {
  const v = mealView(l);
  const at = eatenAtOf(l);
  return {
    id: v.id,
    meal: v.meal,
    title: v.title,
    source: v.source,
    kcal: v.kcal,
    proteinG: v.proteinG,
    confidence: v.confidence,
    tip: v.tip,
    items: v.items,
    demo: v.demo,
    time: clockTime(at, tz),
    at: at.toISOString(),
    lang: langTag((l.micros as { lang?: string } | null)?.lang ?? scriptLanguage(l.title), l.title) ?? null,
  };
}

/**
 * The plan as the apps get it: the web's PlanView with the moments behind its dates, and no
 * words. The apps write their own plan words and take the price from the store (the mobile
 * repo's docs/specs/README.md §2.4, gap G3), so the web's price and "free" never reach them.
 */
export function planJson({ view, passEndsAt, queuedEndsAt }: PlanDetail) {
  return {
    pass: view.pass && passEndsAt ? { until: view.pass.until, endsAt: passEndsAt.toISOString() } : null,
    queued: view.queuedUntil && queuedEndsAt ? { until: view.queuedUntil, endsAt: queuedEndsAt.toISOString() } : null,
    reads: view.reads,
    meals: view.meals,
    readBlock: view.readBlock,
    mealBlock: view.mealBlock,
    canBuy: view.canBuy,
    paymentsOn: view.paymentsOn,
  };
}

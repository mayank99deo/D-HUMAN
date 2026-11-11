import "server-only";
import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import { aiMode } from "@/lib/ai/client";
import { findBrands, type Brand } from "@/lib/ai/stack";
import { db, schema } from "@/lib/db";
import { brandQuery, type RuleId } from "@/lib/domain/supplements";

// Brands for a supplement, shared by everyone who gets it. One web search per
// nutrient and diet variant a month, instead of searches in every stack.

const FRESH_FOR = 30 * 24 * 60 * 60 * 1000;
const RETRY_FAILED_AFTER = 24 * 60 * 60 * 1000;
const RUNNING_FOR = 5 * 60 * 1000;

// Brands are a nice-to-have: if the cache can't be read, the stack still ships without them.
export async function brandsFor(rule: RuleId, diet: string | null): Promise<Brand[]> {
  try {
    return await lookup(rule, diet);
  } catch (error) {
    console.error("[brands] lookup failed; stack goes out without brands", rule, error);
    return [];
  }
}

async function lookup(rule: RuleId, diet: string | null): Promise<Brand[]> {
  const { key, nutrient, form } = brandQuery(rule, diet);
  const d = await db();
  const picks = schema.brandPicks;
  const [row] = await d.select().from(picks).where(eq(picks.key, key)).limit(1);
  const cached = (row?.brands as Brand[] | undefined) ?? [];
  const age = row ? Date.now() - row.fetchedAt.getTime() : Infinity;
  if (row && (row.status === "ok" || row.status === "empty") && age < FRESH_FOR) return cached;
  if (row?.status === "failed" && age < RETRY_FAILED_AFTER) return cached;
  if (aiMode() !== "live") return cached;

  // Claim the search, so parallel stacks wanting the same brands run one search between them.
  const now = new Date();
  const [claimed] = await d
    .insert(picks)
    .values({ key, nutrient, brands: [], status: "running", fetchedAt: now })
    .onConflictDoUpdate({
      target: picks.key,
      set: { status: "running", fetchedAt: now },
      setWhere: or(ne(picks.status, "running"), lt(picks.fetchedAt, new Date(Date.now() - RUNNING_FOR))),
    })
    .returning({ key: picks.key });
  if (!claimed) return cached;

  try {
    const { brands, model } = await findBrands({ nutrient, form });
    await d
      .update(picks)
      .set({ brands, status: brands.length ? "ok" : "empty", model, fetchedAt: new Date() })
      .where(and(eq(picks.key, key), eq(picks.status, "running")));
    return brands;
  } catch (error) {
    console.error("[brands]", key, error);
    // Keep whatever brands we had; try again tomorrow.
    await d
      .update(picks)
      .set({ status: "failed", fetchedAt: new Date(), brands: sql`${picks.brands}` })
      .where(and(eq(picks.key, key), eq(picks.status, "running")));
    return cached;
  }
}

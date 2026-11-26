-- Meals from the native apps (the mobile repo's docs/API.md §3.4). eaten_at: when a meal queued
-- offline on a phone was eaten, which sets its local_date; null for every meal sent at once, so
-- every existing row and every web meal stays as it is. input_raw: what a Hinglish or English
-- pick heard in Devanagari, kept before the words were put in Latin letters on arrival.
-- repeat_of: the meal a "Log again" copied, as a plain id (that meal may be deleted later).
-- Additive only: nullable columns, no default, no index, no existing value changed. Row-level
-- security is already on for food_logs (0001). Safe to run more than once, before or after the
-- deploy's migrator. Hand-written from drizzle-kit's output; drizzle/meta/0013_snapshot.json is
-- its snapshot.
ALTER TABLE "food_logs" ADD COLUMN IF NOT EXISTS "eaten_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "food_logs" ADD COLUMN IF NOT EXISTS "input_raw" text;
--> statement-breakpoint
ALTER TABLE "food_logs" ADD COLUMN IF NOT EXISTS "repeat_of" text;
--> statement-breakpoint
ALTER TABLE "food_logs" ENABLE ROW LEVEL SECURITY;

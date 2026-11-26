-- The apps' health question (the mobile repo's docs/specs/README.md, gap G2): before a first
-- stack, the apps ask about conditions (pregnancy among them) and medicines, and record when the
-- person answered. Null for everyone until then, so every existing profile and the web are as
-- they were (the web never asks it, and its stack builds don't check it).
-- Additive only: one nullable column, no default, no index. Row-level security is already on for
-- profiles (0001). Safe to run more than once, before or after the deploy's migrator.
-- Hand-written from drizzle-kit's output; drizzle/meta/0014_snapshot.json is its snapshot.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "health_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;

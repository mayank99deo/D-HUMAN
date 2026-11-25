-- Sign-in for the native apps (the mobile repo's docs/API.md §2.2). The apps' bearer tokens
-- live in sessions beside the web's cookies, hashed the same way; kind says which a row is,
-- and every existing row is the web's ('cookie'). public_id is the handle the device list and
-- remote sign-out use, so the hash never leaves the server; existing rows get one here, and
-- every new row by default, so the web's own inserts don't change. last_used_at and
-- absolute_expires_at carry the apps' sliding 90-day expiry and its 365-day cap.
-- kind is checked to be one of the two, so no typo makes a third that a lookup misses.
-- Additive only: no column dropped, no existing value changed. Row-level security is already
-- on for sessions (0001). Safe to run more than once, before or after the deploy's migrator.
-- Hand-written from drizzle-kit's output; drizzle/meta/0012_snapshot.json is its snapshot.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'cookie' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "public_id" text DEFAULT gen_random_uuid()::text NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "device_label" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "client" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "absolute_expires_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_public_id_idx" ON "sessions" USING btree ("public_id");
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_kind_check" CHECK ("sessions"."kind" in ('cookie', 'bearer'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- The apps' in-app purchase (the mobile repo's docs/API.md §8, gap G8): each person's
-- appAccountToken, a UUID made on first use and carried in the purchase, so our own user id
-- never goes to Apple. Null for everyone until then; nothing on the web reads it.
-- Additive only: one nullable column and its unique constraint. Row-level security is already
-- on for users (0001). Safe to run more than once, before or after the deploy's migrator.
-- Hand-written from drizzle-kit's output; drizzle/meta/0015_snapshot.json is its snapshot.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "store_account_token" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_store_account_token_unique" UNIQUE("store_account_token");
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;

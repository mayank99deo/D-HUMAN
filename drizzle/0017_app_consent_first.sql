-- The first agreement, kept as a DPDP record (the mobile repo's round 3, item 6). When an app
-- records agreement to newer consent wording, consent_at moves to that moment; consent_first_at
-- keeps when the person first agreed. Null for everyone until then, which means consent_at is
-- still the first agreement, so no existing row needs a value and the web is as it was.
-- Additive only: one nullable column, no default, no index. Row-level security is already on for
-- profiles (0001). Safe to run more than once, before or after the deploy's migrator.
-- Hand-written from drizzle-kit's output; drizzle/meta/0017_snapshot.json is its snapshot.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "consent_first_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;

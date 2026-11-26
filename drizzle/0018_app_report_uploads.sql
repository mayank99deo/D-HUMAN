-- Report uploads from the apps (the mobile repo's docs/API.md §3.4, gap G10). upload_key: the
-- try's key, unique per person when set, so a resend returns the same report and never claims a
-- second read. pages: { sent, of } when the phone could send only some of a long report's pages.
-- Null for every existing report and every web upload, so nothing changes for them.
-- Additive only: two nullable columns and a partial unique index. Row-level security is already
-- on for reports (0001). Safe to run more than once, before or after the deploy's migrator.
-- Hand-written from drizzle-kit's output; drizzle/meta/0018_snapshot.json is its snapshot.
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "upload_key" text;
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "pages" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reports_user_upload_key_idx" ON "reports" USING btree ("user_id","upload_key") WHERE "reports"."upload_key" is not null;
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;

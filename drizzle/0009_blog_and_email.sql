-- The blog (authors, posts with a draft and a live copy, old slugs, photos, publish records,
-- review requests), lifecycle email (settings, send ledger, suppressions), feedback answers,
-- a lease for scheduled jobs, and wraps.finished_at. Every new table has row-level security
-- on with no policies, like the rest. Safe to run more than once, before or after the deploy's
-- migrator (Mayank may paste it into Supabase's SQL editor). Hand-written from drizzle-kit's
-- output for the same schema; drizzle/meta/0009_snapshot.json is that output's snapshot.
CREATE TABLE IF NOT EXISTS "blog_authors" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"photo_image_id" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_authors_email_unique" UNIQUE("email"),
	CONSTRAINT "blog_authors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"topic" text,
	"language" text DEFAULT 'en' NOT NULL,
	"author_id" text NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_version" integer DEFAULT 1 NOT NULL,
	"draft_updated_by" text,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"live" jsonb,
	"live_version" integer,
	"published_at" timestamp with time zone,
	"updated_on" timestamp with time zone,
	"live_changed_at" timestamp with time zone,
	"editing_by" text,
	"editing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_blog_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."blog_authors"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_posts_live_idx" ON "blog_posts" USING btree ("published_at" DESC NULLS LAST) WHERE "status" = 'live';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_one_featured_idx" ON "blog_posts" USING btree ("featured") WHERE "featured";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_slugs" (
	"slug" text PRIMARY KEY NOT NULL,
	"post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_slugs" ADD CONSTRAINT "blog_slugs_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_images" (
	"id" text PRIMARY KEY NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"focal_x" real DEFAULT 0.5 NOT NULL,
	"focal_y" real DEFAULT 0.5 NOT NULL,
	"keep_colour" boolean DEFAULT false NOT NULL,
	"own_rights" boolean DEFAULT true NOT NULL,
	"credit" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_image_files" (
	"image_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"bytes" bytea NOT NULL,
	CONSTRAINT "blog_image_files_image_id_name_pk" PRIMARY KEY("image_id","name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_image_files" ADD CONSTRAINT "blog_image_files_image_id_blog_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."blog_images"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_publishes" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"action" text NOT NULL,
	"draft_version" integer NOT NULL,
	"by_author" text NOT NULL,
	"checklist" jsonb,
	"checks" jsonb,
	"meaningful" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_publishes" ADD CONSTRAINT "blog_publishes_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_publishes_post_idx" ON "blog_publishes" USING btree ("post_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"draft_version" integer NOT NULL,
	"requested_by" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blog_reviews" ADD CONSTRAINT "blog_reviews_post_id_blog_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."blog_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_reviews_post_idx" ON "blog_reviews" USING btree ("post_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"weekly" boolean DEFAULT true NOT NULL,
	"questions" boolean DEFAULT true NOT NULL,
	"weekly_paused_at" timestamp with time zone,
	"updated_via" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_prefs" ADD CONSTRAINT "email_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"variant" text,
	"local_date" date NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"batch_id" text,
	"provider_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"first_tap_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_dedupe_idx" ON "email_sends" USING btree ("user_id","kind","dedupe_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_provider_idx" ON "email_sends" USING btree ("provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_sent_idx" ON "email_sends" USING btree ("sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_open_idx" ON "email_sends" USING btree ("created_at") WHERE "status" IN ('sending', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_suppressions" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"survey" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"path" text,
	"source" text NOT NULL,
	"contact_ok" boolean DEFAULT false NOT NULL,
	"conflict_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sheet_synced_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback_answers" ADD CONSTRAINT "feedback_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_answers_question_idx" ON "feedback_answers" USING btree ("user_id","survey","question");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_answers_unsynced_idx" ON "feedback_answers" USING btree ("updated_at") WHERE "sheet_synced_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_runs" (
	"job" text PRIMARY KEY NOT NULL,
	"lease_until" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"last_result" jsonb
);
--> statement-breakpoint
ALTER TABLE "wraps" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "blog_authors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_slugs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_images" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_image_files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_publishes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_prefs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_sends" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "feedback_answers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;

-- Safe to run more than once: every statement skips what already exists.
CREATE TABLE IF NOT EXISTS "analyses" (
	"report_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"read" jsonb NOT NULL,
	"event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "diet_baselines" (
	"user_id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"estimate" jsonb NOT NULL,
	"model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_searches" (
	"activity" text NOT NULL,
	"region" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_searches_activity_region_query_pk" PRIMARY KEY("activity","region","query")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" text PRIMARY KEY NOT NULL,
	"activity" text NOT NULL,
	"region" text NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"starts_on" date,
	"ends_on" date,
	"city" text,
	"country" text,
	"url" text,
	"details" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"local_date" date NOT NULL,
	"meal" text NOT NULL,
	"source" text NOT NULL,
	"input_text" text,
	"title" text NOT NULL,
	"items" jsonb NOT NULL,
	"kcal" real NOT NULL,
	"protein_g" real NOT NULL,
	"carbs_g" real NOT NULL,
	"fat_g" real NOT NULL,
	"fibre_g" real NOT NULL,
	"micros" jsonb NOT NULL,
	"confidence" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "markers" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"panel" text,
	"value" double precision,
	"value_text" text,
	"unit" text,
	"ref_low" double precision,
	"ref_high" double precision,
	"ref_text" text,
	"range_source" text,
	"status" text NOT NULL,
	"flag" text,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"birth_year" integer,
	"sex" text,
	"height_cm" real,
	"weight_kg" real,
	"city" text,
	"country" text DEFAULT 'India',
	"timezone" text DEFAULT 'Asia/Kolkata',
	"language" text DEFAULT 'en' NOT NULL,
	"activities" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_activity" text,
	"level" text,
	"sessions_per_week" integer,
	"goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"event_in_mind" text,
	"diet" text,
	"conditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"medications" text,
	"current_supplements" text,
	"consent_at" timestamp with time zone,
	"onboarded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_files" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"position" integer NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"stage" text,
	"file_name" text,
	"file_count" integer DEFAULT 1 NOT NULL,
	"total_bytes" integer DEFAULT 0 NOT NULL,
	"lab_name" text,
	"collected_on" date,
	"name_on_report" text,
	"model" text,
	"review_status" text DEFAULT 'ai_only' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stacks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"report_id" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"plan" jsonb,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_events" (
	"user_id" text NOT NULL,
	"event_id" text NOT NULL,
	"target" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_events_user_id_event_id_pk" PRIMARY KEY("user_id","event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wraps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"stats" jsonb NOT NULL,
	"story" jsonb NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "analyses" ADD CONSTRAINT "analyses_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "analyses" ADD CONSTRAINT "analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "diet_baselines" ADD CONSTRAINT "diet_baselines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "markers" ADD CONSTRAINT "markers_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "markers" ADD CONSTRAINT "markers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "report_files" ADD CONSTRAINT "report_files_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "stacks" ADD CONSTRAINT "stacks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "stacks" ADD CONSTRAINT "stacks_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_events" ADD CONSTRAINT "user_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_events" ADD CONSTRAINT "user_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "wraps" ADD CONSTRAINT "wraps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "events_unique_idx" ON "events" USING btree ("activity","region","name","starts_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_lookup_idx" ON "events" USING btree ("activity","region","starts_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_logs_user_date_idx" ON "food_logs" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_codes_email_idx" ON "login_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markers_user_key_idx" ON "markers" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markers_report_idx" ON "markers" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_user_idx" ON "reports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stacks_user_idx" ON "stacks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wraps_unique_idx" ON "wraps" USING btree ("user_id","period","starts_on");
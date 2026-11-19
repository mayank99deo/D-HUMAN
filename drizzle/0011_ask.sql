-- Ask, the in-app assistant (docs/team/specs/2026-11-19-ask-data.md). ask_turns holds each
-- question and its answer until the daily job deletes them; ask_days holds each person's
-- count for an IST day, with no text, so deleting questions or a report never resets it;
-- ask_totals holds everyone's count for an IST day (the spend circuit breaker), with no
-- personal data. profiles.ask_consent_at is when someone agreed to Ask's notice.
-- Row-level security on with no policies, like every table. Safe to run more than once,
-- before or after the deploy's migrator. Hand-written from drizzle-kit's output;
-- drizzle/meta/0011_snapshot.json is its snapshot.
CREATE TABLE IF NOT EXISTS "ask_days" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ask_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "ask_days" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ask_totals" (
	"day" date PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"answered" integer DEFAULT 0 NOT NULL,
	"off_topic" integer DEFAULT 0 NOT NULL,
	"doctor" integer DEFAULT 0 NOT NULL,
	"urgent" integer DEFAULT 0 NOT NULL,
	"crisis" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ask_totals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ask_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_key" text NOT NULL,
	"day" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"kind" text,
	"counted" boolean DEFAULT true NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"notice" jsonb,
	"links" jsonb,
	"lang" text,
	"report_id" text,
	"removed_at" timestamp with time zone,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ask_turns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "ask_consent_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ask_days" ADD CONSTRAINT "ask_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ask_turns" ADD CONSTRAINT "ask_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_turns_user_day_idx" ON "ask_turns" USING btree ("user_id","day","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ask_turns_client_key_idx" ON "ask_turns" USING btree ("user_id","client_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ask_turns_day_idx" ON "ask_turns" USING btree ("day");

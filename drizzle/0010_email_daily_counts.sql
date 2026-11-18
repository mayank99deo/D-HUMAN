-- A count per UTC day of emails sent outside the lifecycle ledger and sign-in codes (the
-- waitlist welcome, the founders' alert), so the daily email budget sees everything that
-- uses Resend's free 100 a day. Counts only, no addresses. Row-level security on with no
-- policies, like every table. Safe to run more than once, before or after the deploy's
-- migrator. Hand-written from drizzle-kit's output; drizzle/meta/0010_snapshot.json is its snapshot.
CREATE TABLE IF NOT EXISTS "email_daily_counts" (
	"day" date NOT NULL,
	"stream" text NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "email_daily_counts_day_stream_pk" PRIMARY KEY("day","stream")
);
--> statement-breakpoint
ALTER TABLE "email_daily_counts" ENABLE ROW LEVEL SECURITY;

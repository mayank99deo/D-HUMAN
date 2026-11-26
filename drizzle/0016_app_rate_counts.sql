-- The apps' cost guards (QA's review of lane 1A, finding 1): how often an app token set off a paid
-- call in a window, per person and for everyone, so app requests can be refused past a cap. The
-- web's requests never touch it. Counts only: a subject ("events:<user id>", "usual:<user id>",
-- "app-ai"), the window's first day in IST, and a count.
-- A new table, so nothing existing changes. Row-level security on with no policies, like every
-- table, so Supabase's Data API returns nothing. Safe to run more than once, before or after the
-- deploy's migrator. Hand-written from drizzle-kit's output; drizzle/meta/0016_snapshot.json is
-- its snapshot.
CREATE TABLE IF NOT EXISTS "app_rate_counts" (
	"subject" text NOT NULL,
	"window" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_rate_counts_subject_window_pk" PRIMARY KEY("subject","window")
);
--> statement-breakpoint
ALTER TABLE "app_rate_counts" ENABLE ROW LEVEL SECURITY;

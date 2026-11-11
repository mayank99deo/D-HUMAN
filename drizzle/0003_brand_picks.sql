-- Shared supplement brand picks. Safe to run more than once.
CREATE TABLE IF NOT EXISTS "brand_picks" (
	"key" text PRIMARY KEY NOT NULL,
	"nutrient" text NOT NULL,
	"brands" jsonb NOT NULL,
	"status" text NOT NULL,
	"model" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_picks" ENABLE ROW LEVEL SECURITY;
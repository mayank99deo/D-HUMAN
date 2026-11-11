-- Which Razorpay keys made an order (a test-mode pass never counts under live keys),
-- and when an unpaid order was last checked with Razorpay. Safe to run more than once.
-- Its snapshot (meta/0005_snapshot.json) also records 0004's tables, written by hand.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'live' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "checked_at" timestamp with time zone;

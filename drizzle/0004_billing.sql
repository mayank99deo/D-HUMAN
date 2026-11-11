-- Paid passes (Razorpay orders) and the usage ledger that free and paid limits are
-- counted from. Safe to run more than once. Past reads and meal logs are copied into
-- the ledger, so the free allowance counts everything a person has already used.
CREATE TABLE IF NOT EXISTS "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"order_id" text NOT NULL,
	"payment_id" text,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"method" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"local_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage" ADD CONSTRAINT "usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_user_idx" ON "payments" USING btree ("user_id","status","ends_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_kind_ref_idx" ON "usage" USING btree ("kind","ref_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_user_idx" ON "usage" USING btree ("user_id","kind","created_at");
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "usage" ("id", "user_id", "kind", "ref_id", "local_date", "created_at")
SELECT gen_random_uuid()::text, "user_id", 'read', "id", NULL, "analyzed_at" FROM "reports" WHERE "analyzed_at" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "usage" ("id", "user_id", "kind", "ref_id", "local_date", "created_at")
SELECT gen_random_uuid()::text, "user_id", 'meal', "id", "local_date", "created_at" FROM "food_logs"
ON CONFLICT DO NOTHING;

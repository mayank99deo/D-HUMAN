-- Safe to run more than once, in either order with the deploy's own migration:
-- every statement skips what already exists. Needs Postgres 15 or later (NULLS NOT DISTINCT).
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "query" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Undated events were stored again on every refresh (Postgres treats NULL dates as
-- different). Merge the copies, keeping the newest, then add a key that treats them as one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_unique' AND conrelid = 'public.events'::regclass) THEN
    -- Keep writers out until the key is in place, so no new copy slips in.
    LOCK TABLE "events" IN SHARE ROW EXCLUSIVE MODE;
    -- Someone who picked a copy now points at the row that stays.
    INSERT INTO "user_events" ("user_id", "event_id", "target", "created_at")
    SELECT ue."user_id", d."keep_id", bool_or(ue."target"), min(ue."created_at")
    FROM "user_events" ue
    JOIN (
      SELECT "id", first_value("id") OVER w AS "keep_id"
      FROM "events"
      WINDOW w AS (PARTITION BY "activity", "region", "query", "name", "starts_on" ORDER BY "fetched_at" DESC, "id" DESC)
    ) d ON d."id" = ue."event_id" AND d."id" <> d."keep_id"
    GROUP BY ue."user_id", d."keep_id"
    ON CONFLICT ("user_id", "event_id") DO NOTHING;
    -- So does a read that aimed at a copy.
    UPDATE "analyses" a SET "event_id" = d."keep_id"
    FROM (
      SELECT "id", first_value("id") OVER w AS "keep_id"
      FROM "events"
      WINDOW w AS (PARTITION BY "activity", "region", "query", "name", "starts_on" ORDER BY "fetched_at" DESC, "id" DESC)
    ) d
    WHERE a."event_id" = d."id" AND d."id" <> d."keep_id";
    -- The copies go; their old picks go with them (ON DELETE CASCADE).
    DELETE FROM "events" e
    USING (
      SELECT "id", first_value("id") OVER w AS "keep_id"
      FROM "events"
      WINDOW w AS (PARTITION BY "activity", "region", "query", "name", "starts_on" ORDER BY "fetched_at" DESC, "id" DESC)
    ) d
    WHERE e."id" = d."id" AND d."id" <> d."keep_id";
    ALTER TABLE "events" ADD CONSTRAINT "events_unique" UNIQUE NULLS NOT DISTINCT ("activity", "region", "query", "name", "starts_on");
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "events_unique_idx";--> statement-breakpoint
-- A stack holds its report's marker values, so it is deleted with the report (was SET NULL).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stacks_report_id_reports_id_fk' AND conrelid = 'public.stacks'::regclass AND confdeltype <> 'c') THEN
    ALTER TABLE "stacks" DROP CONSTRAINT "stacks_report_id_reports_id_fk";
  END IF;
  ALTER TABLE "stacks" ADD CONSTRAINT "stacks_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analyses_user_idx" ON "analyses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_files_report_idx" ON "report_files" USING btree ("report_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stacks_report_idx" ON "stacks" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_events_event_idx" ON "user_events" USING btree ("event_id");

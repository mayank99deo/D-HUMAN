-- The first-run tour: when each person finished or skipped it, so it shows once,
-- on any device. Everyone already onboarded counts as done, so only people who
-- finish onboarding from now on see it. Safe to run more than once: the column and
-- its backfill happen together, only on the run that adds the column, so running
-- this again later never hides the tour from someone who onboarded since.
DO $$ BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'profiles' AND column_name = 'tour_done_at'
 ) THEN
  ALTER TABLE "profiles" ADD COLUMN "tour_done_at" timestamp with time zone;
  UPDATE "profiles" SET "tour_done_at" = now() WHERE "onboarded_at" IS NOT NULL;
 END IF;
END $$;

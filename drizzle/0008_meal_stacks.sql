-- Stacks can now be built from meals alone, before any blood report, and those have no
-- report (report_id null). The only other stacks without one are left over from reports
-- deleted before 0002 made stacks go with their report: built from markers that are gone.
-- Removing them means "no report" always reads as "built from meals". Safe to run more
-- than once.
DELETE FROM "stacks" WHERE "report_id" IS NULL AND "created_at" < '2026-11-17';

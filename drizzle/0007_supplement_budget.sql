-- Each person's monthly supplement budget (lib/domain/budget.ts), picked on the
-- Stack screen; the stack is fitted to it. Null until they pick one. Safe to run
-- more than once.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "supplement_budget" text;

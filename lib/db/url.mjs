// The Postgres connection string, from DATABASE_URL or, when Supabase or Neon was
// connected through Vercel's integration, POSTGRES_URL (their pooled string).
// Supabase's adds `supa=base-pooler.x` (and older ones `pgbouncer=true`); the
// driver would send those to Postgres as settings, which it rejects, so they go.
/** @returns {string | null} */
export function databaseUrl() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!raw || !/^postgres(ql)?:\/\//.test(raw)) return null;
  const url = new URL(raw);
  for (const key of ["supa", "pgbouncer"]) url.searchParams.delete(key);
  return url.toString();
}

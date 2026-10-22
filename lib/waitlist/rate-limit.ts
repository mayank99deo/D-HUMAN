import "server-only";

// Best-effort, in-memory limiter. On serverless hosts each instance keeps its
// own counts, so treat this as a speed bump for bots, not a hard guarantee.

const buckets = new Map<string, { count: number; resetAt: number }>();

export function allowRequest(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > 5_000) {
    for (const [k, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function clientIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}

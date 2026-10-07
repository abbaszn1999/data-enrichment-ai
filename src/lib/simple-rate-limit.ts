/**
 * Minimal in-memory fixed-window rate limiter (per server instance).
 * Good enough to slow brute force on a single Render instance; use a shared
 * store (Upstash/Redis) or Cloudflare rules if you scale horizontally.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (
    req.headers.get("cf-connecting-ip") ||
    fwd?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

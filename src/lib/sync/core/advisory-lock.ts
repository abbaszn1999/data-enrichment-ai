// Postgres advisory lock helper for concurrency control in sync operations.
// Uses `pg_try_advisory_xact_lock` which auto-releases at transaction end.
//
// Because Supabase's REST doesn't expose true transactions from Next.js easily,
// we use `pg_try_advisory_lock` (session-scoped) + explicit `pg_advisory_unlock`
// wrapped in a try/finally. Each Supabase admin client call is its own connection
// pooled session, so we hash a stable key and hold the lock for the duration of
// the async work.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Stable 64-bit key derived from a string using hashtextextended (database-side). */
function buildLockKey(scope: string, id: string): string {
  return `${scope}:${id}`;
}

/**
 * Try to acquire a session-level advisory lock.
 * Returns `true` if acquired, `false` if another session holds it.
 */
export async function tryAcquireAdvisoryLock(
  admin: SupabaseClient,
  scope: string,
  id: string
): Promise<boolean> {
  const key = buildLockKey(scope, id);
  const { data, error } = await admin.rpc("try_advisory_lock_text", { p_key: key });
  if (error) {
    // RPC may not exist yet — fall through with raw SQL via service role.
    // Consumers should ensure the RPC is installed (see migration below).
    throw new Error(`Advisory lock RPC not available: ${error.message}`);
  }
  return data === true;
}

/** Release an advisory lock acquired by `tryAcquireAdvisoryLock`. */
export async function releaseAdvisoryLock(
  admin: SupabaseClient,
  scope: string,
  id: string
): Promise<void> {
  const key = buildLockKey(scope, id);
  await admin.rpc("advisory_unlock_text", { p_key: key });
}

/**
 * Run `fn` while holding an advisory lock. Returns `{ acquired: false }` if the
 * lock was already held by another session; otherwise runs and releases.
 */
export async function withAdvisoryLock<T>(
  admin: SupabaseClient,
  scope: string,
  id: string,
  fn: () => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const got = await tryAcquireAdvisoryLock(admin, scope, id);
  if (!got) return { acquired: false };
  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    try {
      await releaseAdvisoryLock(admin, scope, id);
    } catch {
      // Best-effort — if release fails the lock will clear when the session ends.
    }
  }
}

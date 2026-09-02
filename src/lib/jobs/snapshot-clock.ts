/**
 * Monotonic snapshot fence for background-job UIs.
 *
 * Same idea as Inngest trace_runs and TanStack Query stale-response
 * guards: a later HTTP response must not move a newer revision backward.
 */

export function snapshotRevision(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function maxRevision(...values: unknown[]): number {
  return values.reduce<number>(
    (highest, value) => Math.max(highest, snapshotRevision(value)),
    0
  );
}

export function isNewerRevision(incoming: unknown, current: unknown): boolean {
  return snapshotRevision(incoming) > snapshotRevision(current);
}

export function isStaleRevision(incoming: unknown, current: unknown): boolean {
  return snapshotRevision(incoming) < snapshotRevision(current);
}

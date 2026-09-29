/**
 * Upper bound for one row that runs inside a session.
 *
 * Rows used to run as their own Render task, and Render ended a task that ran
 * past its timeout. Now they share the session's process, so nothing else
 * would ever end a row that hangs — and because the session keeps pinging its
 * heartbeat, recovery would never step in either. Every real call already has
 * its own timeout; this is the last line of defense that turns a hung row into
 * a failed row instead of a job that never finishes.
 */
export async function withRowBackstop<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

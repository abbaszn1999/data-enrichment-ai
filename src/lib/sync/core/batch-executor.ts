// Concurrency-limited batch executor with optional inter-batch delay.

export type BatchExecutorOptions = {
  concurrency?: number;
  delayMsBetweenBatches?: number;
};

export type BatchResult<T> = {
  successes: T[];
  errors: Array<{ index: number; error: string }>;
};

export async function runWithConcurrency<I, O>(
  items: I[],
  worker: (item: I, index: number) => Promise<O>,
  opts: BatchExecutorOptions = {}
): Promise<BatchResult<O>> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const delay = Math.max(0, opts.delayMsBetweenBatches ?? 0);

  const successes: O[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((item, j) => worker(item, i + j))
    );
    results.forEach((res, j) => {
      if (res.status === "fulfilled") {
        successes.push(res.value);
      } else {
        const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
        errors.push({ index: i + j, error: msg });
      }
    });
    if (delay > 0 && i + concurrency < items.length) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { successes, errors };
}

/** Splits an array into chunks of `size`. */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

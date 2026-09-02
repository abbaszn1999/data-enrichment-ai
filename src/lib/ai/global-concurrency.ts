const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiters: Array<() => void> = [];

export async function withAiSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight = Math.max(0, inFlight - 1);
    waiters.shift()?.();
  }
}

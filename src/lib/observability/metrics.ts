type MetricTags = Record<string, string | number | undefined>;

function emit(name: string, value: number, tags?: MetricTags) {
  if (process.env.NODE_ENV === "test") return;
  const payload = {
    metric: name,
    value,
    tags: tags ?? {},
    t: new Date().toISOString(),
  };
  console.info("[metric]", JSON.stringify(payload));
}

/** Storage bytes written per job artifact (Issue 3.1 / 5.2 / 6.2). */
export function recordStorageWriteBytes(
  bytes: number,
  tags: { kind?: string; jobRunId?: string; workspaceId?: string }
) {
  emit("storage.write_bytes", bytes, tags);
}

/** Public embed latency — sits on the merchant's revenue path. */
export function recordEmbedLatencyMs(ms: number) {
  emit("embed.content.latency_ms", Math.round(ms));
}

/** Response payload size for gallery poll and wallet ledger. */
export function recordResponseBytes(route: string, bytes: number) {
  emit("http.response_bytes", bytes, { route });
}

/** Peak Node.js heap for a worker (Issues 4.2 / 6.3). */
export function recordWorkerHeapBytes(bytes: number, tags: { kind?: string; runId?: string }) {
  emit("worker.heap_used_bytes", bytes, tags);
}

export function jsonByteLength(payload: unknown): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

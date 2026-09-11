const APIFY_BASE = "https://api.apify.com/v2";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTING"
  | "ABORTED"
  | "TIMING-OUT"
  | "TIMED-OUT";

export type ApifyRun = {
  id: string;
  actId: string;
  status: ApifyRunStatus;
  defaultDatasetId: string;
  statusMessage?: string;
};

function token(): string {
  const value = process.env.APIFY_TOKEN?.trim();
  if (!value) {
    throw new ApifyError("APIFY_TOKEN is not configured");
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apifyFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; retry?: boolean } = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retry = true, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const retryableMethod = method === "GET";
  let lastError: unknown;

  const attempts = retry && retryableMethod ? MAX_RETRIES : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${APIFY_BASE}${path}`, {
        ...rest,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token()}`,
          ...(rest.body ? { "Content-Type": "application/json" } : {}),
          ...rest.headers,
        },
      });
      if (response.status === 429 || response.status >= 500) {
        const retryable = retry && (retryableMethod || response.status === 429);
        if (retryable && attempt < attempts) {
          await sleep(400 * 2 ** (attempt - 1));
          continue;
        }
        throw new ApifyError(
          `Apify ${response.status} on ${method} ${path}`,
          response.status,
          true
        );
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ApifyError(
          `Apify ${response.status} on ${method} ${path}${body ? `: ${body.slice(0, 240)}` : ""}`,
          response.status,
          false
        );
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (error instanceof ApifyError) throw error;
      if (attempt >= attempts) {
        throw new ApifyError(
          error instanceof Error ? error.message : "Apify request failed",
          undefined,
          true
        );
      }
      await sleep(400 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new ApifyError("Apify request failed");
}

export function actorSeedMetricsId(): string {
  return process.env.APIFY_ACTOR_SEED_METRICS?.trim() || "9FWL3X6mVI2izVfeJ";
}

export function actorKeywordIdeasId(): string {
  return process.env.APIFY_ACTOR_KEYWORD_IDEAS?.trim() || "7LH0CgHLrGbpFh49M";
}

const resolvedActorIds = new Map<string, Promise<string>>();

/**
 * Actor ids can be configured as `user~name`, so the raw config value cannot be
 * compared against `run.actId`. Resolve once and cache for ownership checks.
 */
export function resolveActorId(actorId: string): Promise<string> {
  const cached = resolvedActorIds.get(actorId);
  if (cached) return cached;
  const pending = apifyFetch<{ data: { id: string } }>(
    `/acts/${encodeURIComponent(actorId.replace("/", "~"))}`
  )
    .then((payload) => payload?.data?.id || actorId)
    .catch((error) => {
      resolvedActorIds.delete(actorId);
      throw error;
    });
  resolvedActorIds.set(actorId, pending);
  return pending;
}

/** Guards against a caller passing a run id that we did not create. */
export async function assertRunBelongsToActor(
  run: ApifyRun,
  actorId: string
): Promise<void> {
  if (!run.actId) {
    throw new ApifyError("Run has no actor id", 403);
  }
  const expected = await resolveActorId(actorId);
  if (run.actId !== expected) {
    throw new ApifyError("Run does not belong to this actor", 403);
  }
}

export async function startActorRun(
  actorId: string,
  input: unknown
): Promise<ApifyRun> {
  const payload = await apifyFetch<{ data: ApifyRun }>(
    `/acts/${encodeURIComponent(actorId.replace("/", "~"))}/runs`,
    {
      method: "POST",
      body: JSON.stringify(input),
      retry: false,
      timeoutMs: 30_000,
    }
  );
  if (!payload?.data?.id) {
    throw new ApifyError("Apify start returned no run id");
  }
  return payload.data;
}

export async function getActorRun(runId: string): Promise<ApifyRun> {
  const payload = await apifyFetch<{ data: ApifyRun }>(
    `/actor-runs/${encodeURIComponent(runId)}`
  );
  if (!payload?.data?.id) {
    throw new ApifyError("Apify run lookup returned no run");
  }
  return payload.data;
}

export async function abortActorRun(runId: string): Promise<void> {
  await apifyFetch(`/actor-runs/${encodeURIComponent(runId)}/abort`, {
    method: "POST",
    retry: false,
  });
}

export async function listDatasetItems<T>(
  datasetId: string,
  offset: number,
  limit: number
): Promise<T[]> {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit)));
  const items = await apifyFetch<T[]>(
    `/datasets/${encodeURIComponent(datasetId)}/items?offset=${safeOffset}&limit=${safeLimit}&clean=true`
  );
  return Array.isArray(items) ? items : [];
}

export function isTerminalRunStatus(status: string): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "ABORTED" ||
    status === "TIMED-OUT"
  );
}

export function mapRunStatus(
  status: string
): "running" | "succeeded" | "failed" | "aborted" {
  if (status === "SUCCEEDED") return "succeeded";
  if (status === "FAILED" || status === "TIMED-OUT") return "failed";
  if (status === "ABORTED") return "aborted";
  return "running";
}

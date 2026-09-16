/**
 * In-memory server-side LRU-like / TTL cache for expensive analytics calculations and Google API responses.
 */

type CacheEntry<T> = {
  data: T;
  ts: number;
};

const serverCache = new Map<string, CacheEntry<unknown>>();
const pendingFetches = new Map<string, Promise<unknown>>();

// Default server cache TTL: 5 minutes (300,000 ms)
const DEFAULT_SERVER_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SERVER_CACHE_ENTRIES = 500;

export function analyticsPropertiesCacheKey(workspaceId: string, type: string): string {
  return `properties:${workspaceId}:${type}`;
}

export async function fetchWithServerCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = DEFAULT_SERVER_CACHE_TTL_MS,
  forceRefresh = false
): Promise<T> {
  const now = Date.now();

  if (!forceRefresh) {
    const cached = serverCache.get(key) as CacheEntry<T> | undefined;
    if (cached && now - cached.ts < ttlMs) {
      return cached.data;
    }
  }

  // Deduplicate concurrent inflight requests for the exact same key
  let inflight = pendingFetches.get(key) as Promise<T> | undefined;
  if (!inflight) {
    inflight = (async () => {
      try {
        const data = await fetcher();
        // Evict oldest entries if map exceeds maximum
        if (serverCache.size >= MAX_SERVER_CACHE_ENTRIES) {
          const firstKey = serverCache.keys().next().value;
          if (firstKey) serverCache.delete(firstKey);
        }
        serverCache.set(key, { data, ts: Date.now() });
        return data;
      } finally {
        pendingFetches.delete(key);
      }
    })();
    pendingFetches.set(key, inflight as Promise<unknown>);
  }

  return inflight;
}

export function invalidateServerAnalyticsCache(workspaceId?: string) {
  if (!workspaceId) {
    serverCache.clear();
    return;
  }
  for (const key of serverCache.keys()) {
    if (key.includes(workspaceId)) {
      serverCache.delete(key);
    }
  }
}

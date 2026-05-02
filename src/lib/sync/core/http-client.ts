import { AuthError, RateLimitError, SyncError } from "./errors";

export type HttpClientOptions = {
  baseUrl: string;
  headers: Record<string, string>;
  provider?: string;
  /** Max retries on 429/503/5xx. */
  maxRetries?: number;
  /** Base delay between retries (ms). Doubles on each retry. */
  retryDelayMs?: number;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: any;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override headers for this request. */
  headers?: Record<string, string>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class HttpClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private provider?: string;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json", ...opts.headers };
    this.provider = opts.provider;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 800;
  }

  /** Returns last response so caller can read headers (e.g. Link, X-WP-TotalPages). */
  async requestRaw(path: string, opts: RequestOptions = {}): Promise<Response> {
    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    let lastError: any;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method: opts.method ?? "GET",
          headers: { ...this.headers, ...(opts.headers ?? {}) },
          body: opts.body !== undefined ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
          cache: "no-store",
        });

        if (response.ok) return response;

        if (response.status === 401 || response.status === 403) {
          const text = await response.text().catch(() => "");
          throw new AuthError(`Authentication failed (${response.status})${text ? `: ${text.slice(0, 200)}` : ""}`, this.provider);
        }

        if (response.status === 429 || response.status === 503 || response.status >= 500) {
          if (attempt < this.maxRetries) {
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : this.retryDelayMs * Math.pow(2, attempt);
            await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : this.retryDelayMs);
            continue;
          }
          if (response.status === 429) {
            throw new RateLimitError(`Rate limited (${response.status}) after ${this.maxRetries} retries`, { provider: this.provider });
          }
        }

        const text = await response.text().catch(() => "");
        throw new SyncError(`Request failed (${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`, {
          status: response.status,
          provider: this.provider,
        });
      } catch (err) {
        lastError = err;
        if (err instanceof AuthError || err instanceof SyncError) throw err;
        if (attempt < this.maxRetries) {
          await sleep(this.retryDelayMs * Math.pow(2, attempt));
          continue;
        }
      }
    }
    throw lastError ?? new SyncError("Unknown HTTP error", { provider: this.provider });
  }

  async request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
    const response = await this.requestRaw(path, opts);
    if (response.status === 204) return undefined as T;
    return (await response.json().catch(() => ({}))) as T;
  }

  async get<T = any>(path: string, query?: RequestOptions["query"]) {
    return this.request<T>(path, { method: "GET", query });
  }

  async post<T = any>(path: string, body?: any) {
    return this.request<T>(path, { method: "POST", body });
  }

  async put<T = any>(path: string, body?: any) {
    return this.request<T>(path, { method: "PUT", body });
  }

  async delete<T = any>(path: string, query?: RequestOptions["query"]) {
    return this.request<T>(path, { method: "DELETE", query });
  }
}

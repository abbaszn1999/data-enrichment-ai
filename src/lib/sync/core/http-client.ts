import { AuthError, RateLimitError, SyncError, TransientError, ValidationError } from "./errors";

/** Exponential backoff with full jitter — prevents synchronized retry storms. */
function backoffWithJitter(baseMs: number, attempt: number): number {
  const exp = baseMs * Math.pow(2, attempt);
  return exp + Math.floor(Math.random() * 250);
}

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
            const retryAfterMs = retryAfterHeader
              ? Number(retryAfterHeader) * 1000
              : backoffWithJitter(this.retryDelayMs, attempt);
            await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : this.retryDelayMs);
            continue;
          }
          const text = await response.text().catch(() => "");
          if (response.status === 429) {
            throw new RateLimitError(`Rate limited (${response.status}) after ${this.maxRetries} retries`, { provider: this.provider });
          }
          throw new TransientError(
            `Server error (${response.status}) after ${this.maxRetries} retries${text ? `: ${text.slice(0, 200)}` : ""}`,
            { status: response.status, provider: this.provider }
          );
        }

        // Remaining 4xx (e.g. 400, 404, 422) — bad request, never retry.
        const text = await response.text().catch(() => "");
        throw new ValidationError(`Request failed (${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`, {
          status: response.status,
          provider: this.provider,
        });
      } catch (err) {
        lastError = err;
        // Typed/classified errors are terminal — don't retry them.
        if (err instanceof SyncError) throw err;
        // Untyped errors are network/transport failures — retry with backoff.
        if (attempt < this.maxRetries) {
          await sleep(backoffWithJitter(this.retryDelayMs, attempt));
          continue;
        }
      }
    }
    throw lastError instanceof SyncError
      ? lastError
      : new TransientError(
          `Network error${lastError?.message ? `: ${String(lastError.message).slice(0, 200)}` : ""}`,
          { provider: this.provider }
        );
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

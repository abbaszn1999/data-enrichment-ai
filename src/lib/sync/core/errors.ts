export class SyncError extends Error {
  status?: number;
  provider?: string;
  constructor(message: string, opts?: { status?: number; provider?: string }) {
    super(message);
    this.name = "SyncError";
    this.status = opts?.status;
    this.provider = opts?.provider;
  }
}

export class AuthError extends SyncError {
  constructor(message: string, provider?: string) {
    super(message, { status: 401, provider });
    this.name = "AuthError";
  }
}

export class RateLimitError extends SyncError {
  retryAfterMs?: number;
  constructor(message: string, opts?: { retryAfterMs?: number; provider?: string }) {
    super(message, { status: 429, provider: opts?.provider });
    this.name = "RateLimitError";
    this.retryAfterMs = opts?.retryAfterMs;
  }
}

/** 4xx (other than 401/403/429) — bad input. Never retry. */
export class ValidationError extends SyncError {
  constructor(message: string, opts?: { status?: number; provider?: string }) {
    super(message, { status: opts?.status ?? 400, provider: opts?.provider });
    this.name = "ValidationError";
  }
}

/** Transient server / network failure (5xx, timeouts). Safe to retry. */
export class TransientError extends SyncError {
  constructor(message: string, opts?: { status?: number; provider?: string }) {
    super(message, { status: opts?.status, provider: opts?.provider });
    this.name = "TransientError";
  }
}

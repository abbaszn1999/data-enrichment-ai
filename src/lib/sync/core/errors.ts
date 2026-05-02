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

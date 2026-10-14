import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-assistant-signature";
export const TIMESTAMP_HEADER = "x-assistant-timestamp";
export const USER_HEADER = "x-assistant-user";

/** Requests older (or newer) than this are rejected, which bounds replays. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function signRequest(params: {
  secret: string;
  timestamp: number;
  userId: string;
  method: string;
  path: string;
  body: string;
}): string {
  const payload = `${params.timestamp}.${params.method.toUpperCase()}.${params.path}.${params.userId}.${params.body}`;
  return createHmac("sha256", params.secret).update(payload).digest("hex");
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyRequest(params: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  userId: string | undefined;
  method: string;
  path: string;
  body: string;
  now?: number;
}): VerifyResult {
  if (!params.timestamp || !params.signature || !params.userId) {
    return { ok: false, reason: "missing auth headers" };
  }
  const timestamp = Number(params.timestamp);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "bad timestamp" };
  const now = params.now ?? Date.now();
  if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS) return { ok: false, reason: "stale timestamp" };
  const expected = signRequest({
    secret: params.secret,
    timestamp,
    userId: params.userId,
    method: params.method,
    path: params.path,
    body: params.body,
  });
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(params.signature, "hex");
  } catch {
    return { ok: false, reason: "bad signature" };
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}

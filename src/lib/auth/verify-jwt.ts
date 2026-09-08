import { createHmac, timingSafeEqual } from "crypto";

function b64urlToBuf(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function jwtSecretFromEnv(): string | null {
  const secret =
    process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || "";
  return secret.trim() || null;
}

export type VerifiedAccessToken = {
  sub: string;
  email?: string;
  role?: string;
  exp?: number;
};

/**
 * Cryptographic JWT verification with no network round-trip.
 * Supabase project JWTs are HS256 signed with the JWT secret from
 * Project Settings → API.
 */
export function verifySupabaseAccessToken(
  token: string,
  secret = jwtSecretFromEnv()
): VerifiedAccessToken | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(b64urlToBuf(headerB64).toString("utf8")) as {
      alg?: string;
    };
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = b64urlToBuf(sigB64);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let payload: VerifiedAccessToken & { exp?: number };
  try {
    payload = JSON.parse(b64urlToBuf(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.sub) return null;
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    return null;
  }
  return payload;
}

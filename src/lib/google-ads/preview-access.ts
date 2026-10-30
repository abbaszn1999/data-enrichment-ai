import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Google Ads is a prototype shown only to people given its password. The
 * password is checked on the server; the browser then holds a signed cookie
 * it cannot forge. Set GOOGLE_ADS_PREVIEW_PASSWORD to change the password.
 */

export const PREVIEW_COOKIE = "ga_preview";
export const PREVIEW_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** SHA-256 of the default password, used when GOOGLE_ADS_PREVIEW_PASSWORD is not set. */
const DEFAULT_PASSWORD_SHA256 = "ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

const sameBytes = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export function isPreviewPassword(password: string): boolean {
  const configured = process.env.GOOGLE_ADS_PREVIEW_PASSWORD;
  const expected = configured ? sha256(configured) : Buffer.from(DEFAULT_PASSWORD_SHA256, "hex");
  return sameBytes(sha256(password), expected);
}

/** The cookie value that grants access, signed with a server secret (and the password, so changing it signs everyone out). */
export function previewToken(): string | null {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  const password = process.env.GOOGLE_ADS_PREVIEW_PASSWORD ?? DEFAULT_PASSWORD_SHA256;
  return createHmac("sha256", secret).update(`google-ads-preview:v1:${password}`).digest("base64url");
}

export function hasPreviewAccess(cookieValue: string | undefined): boolean {
  const token = previewToken();
  return !!token && !!cookieValue && sameBytes(Buffer.from(cookieValue), Buffer.from(token));
}

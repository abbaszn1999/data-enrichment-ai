import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Private access to the agent: a code kept only on the server (ASSISTANT_ACCESS_CODE)
 * unlocks it for one signed-in user, through an httpOnly cookie bound to that user
 * and to the current code. Changing the code locks every browser again.
 * Without a configured code the agent stays locked for everyone.
 */
export const AGENT_ACCESS_COOKIE = "agent_access";
export const AGENT_ACCESS_MAX_AGE = 60 * 60 * 24 * 30;

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function accessCode(): string {
  return (process.env.ASSISTANT_ACCESS_CODE ?? "").trim();
}

export function isAccessCodeConfigured(): boolean {
  return accessCode().length >= 6;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function accessToken(userId: string): string {
  const key = `${process.env.ASSISTANT_SERVICE_SECRET ?? ""}\n${accessCode()}`;
  return createHmac("sha256", key).update(`agent-access:${userId}`).digest("base64url");
}

export async function hasAgentAccess(userId: string): Promise<boolean> {
  if (!isAccessCodeConfigured()) return false;
  const cookie = (await cookies()).get(AGENT_ACCESS_COOKIE)?.value;
  if (!cookie) return false;
  return timingSafeEqual(digest(cookie), digest(accessToken(userId)));
}

export type CodeCheck = { ok: true } | { ok: false; reason: "wrong" | "too_many" | "not_configured" };

/** At most MAX_ATTEMPTS wrong codes per user in ATTEMPT_WINDOW_MS. */
export function checkAccessCode(userId: string, input: string): CodeCheck {
  if (!isAccessCodeConfigured()) return { ok: false, reason: "not_configured" };
  const now = Date.now();
  const entry = attempts.get(userId);
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) return { ok: false, reason: "too_many" };
  if (timingSafeEqual(digest(input.trim()), digest(accessCode()))) {
    attempts.delete(userId);
    return { ok: true };
  }
  const fresh = !entry || entry.resetAt <= now;
  attempts.set(userId, { count: fresh ? 1 : entry.count + 1, resetAt: fresh ? now + ATTEMPT_WINDOW_MS : entry.resetAt });
  return { ok: false, reason: "wrong" };
}

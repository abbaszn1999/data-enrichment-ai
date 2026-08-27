import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
} from "./config";

function credentials() {
  return {
    email: (process.env.PLATFORM_ADMIN_EMAIL || "admin@autommerce.com").trim().toLowerCase(),
    password: process.env.PLATFORM_ADMIN_PASSWORD || "autommerce-ops",
  };
}

function signingSecret(): string {
  return (
    process.env.PLATFORM_ADMIN_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "platform-admin-dev-secret"
  );
}

function sign(expiryUnix: number): string {
  const payload = `v1.${expiryUnix}`;
  const hmac = createHmac("sha256", signingSecret()).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

function tokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiryUnix = Number(parts[1]);
  const given = parts[2];
  if (!Number.isFinite(expiryUnix) || expiryUnix * 1000 < Date.now()) return false;
  const expected = sign(expiryUnix).split(".")[2];
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function passwordsMatch(email: string, password: string): boolean {
  const expected = credentials();
  const emailOk = email.trim().toLowerCase() === expected.email;
  const left = Buffer.from(password);
  const right = Buffer.from(expected.password);
  const passwordOk =
    left.length === right.length ? timingSafeEqual(left, right) : false;
  return emailOk && passwordOk;
}

export async function hasPlatformAdminSession(): Promise<boolean> {
  const store = await cookies();
  return tokenValid(store.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function requirePlatformAdmin(): Promise<NextResponse | null> {
  if (await hasPlatformAdminSession()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function writePlatformAdminSession(): Promise<void> {
  const store = await cookies();
  const expiryUnix = Math.floor(Date.now() / 1000) + ADMIN_SESSION_MAX_AGE_SECONDS;
  store.set(ADMIN_SESSION_COOKIE, sign(expiryUnix), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearPlatformAdminSession(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

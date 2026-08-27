/**
 * Client-safe platform admin settings.
 * Passwords and signing secrets stay in server-auth.ts — never import those here from client components.
 */
export const ADMIN_INTERNAL_PATH = "/admin";

export const ADMIN_BASE_PATH =
  process.env.NEXT_PUBLIC_ADMIN_PATH?.replace(/\/$/, "") || "/admin";

export const ADMIN_SESSION_COOKIE = "autommerce_platform_admin";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export const ADMIN_STAFF = {
  name: "Platform operator",
  email:
    process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAIL ||
    process.env.PLATFORM_ADMIN_EMAIL ||
    "admin@autommerce.com",
} as const;

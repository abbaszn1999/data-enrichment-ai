import { ADMIN_BASE_PATH, ADMIN_INTERNAL_PATH } from "./config";

export function adminPath(suffix = ""): string {
  const rest = suffix.startsWith("/") ? suffix : suffix ? `/${suffix}` : "";
  return `${ADMIN_BASE_PATH}${rest}` || "/";
}

export const ADMIN_LOGIN_PATH = adminPath("/login");

export function isAdminLoginPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === ADMIN_LOGIN_PATH || pathname === `${ADMIN_LOGIN_PATH}/`;
}

export function isAdminPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === ADMIN_BASE_PATH ||
    pathname.startsWith(`${ADMIN_BASE_PATH}/`)
  );
}

export function isAdminInternalPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === ADMIN_INTERNAL_PATH ||
    pathname.startsWith(`${ADMIN_INTERNAL_PATH}/`)
  );
}

export const adminRoutes = {
  overview: () => adminPath(),
  login: () => ADMIN_LOGIN_PATH,
  users: () => adminPath("/users"),
  user: (id: string) => adminPath(`/users/${id}`),
  workspaces: () => adminPath("/workspaces"),
  workspace: (id: string) => adminPath(`/workspaces/${id}`),
  subscriptions: () => adminPath("/subscriptions"),
  credits: () => adminPath("/credits"),
  wallet: () => adminPath("/wallet"),
  jobs: () => adminPath("/jobs"),
  integrations: () => adminPath("/integrations"),
  audit: () => adminPath("/audit"),
} as const;

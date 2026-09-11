/** Canonical Start for Free URL. Marketing: https://platform.autommerce.com/signup */
export const SIGNUP_PATH = "/signup";

export const AUTH_ENTRY_PATHS = ["/login", "/signup", "/sign-up", "/register"] as const;

export function isAuthEntryPath(pathname: string): boolean {
  return (AUTH_ENTRY_PATHS as readonly string[]).includes(pathname);
}

export function isSignupAliasPath(pathname: string): boolean {
  return pathname === "/register" || pathname === "/sign-up";
}

/** Signed-in visitors hitting login/signup go to workspaces, unless they are
 *  completing an invite. */
export function signedInAuthEntryDestination(
  pathname: string,
  redirectParam: string | null | undefined
): string | null {
  if (!isAuthEntryPath(pathname)) return null;
  if (redirectParam && redirectParam.startsWith("/invite/")) return redirectParam;
  return "/workspaces";
}

export function signupIndicatesExistingAccount(input: {
  error?: { message?: string; code?: string } | null;
  user?: { identities?: unknown[] | null } | null;
  session?: unknown | null;
}): boolean {
  const msg = (input.error?.message ?? "").toLowerCase();
  const code = (input.error?.code ?? "").toLowerCase();
  if (
    code === "user_already_exists" ||
    msg.includes("already registered") ||
    msg.includes("already been registered") ||
    msg.includes("user already exists")
  ) {
    return true;
  }
  if (input.error) return false;
  if (input.session) return false;
  return Array.isArray(input.user?.identities) && input.user.identities.length === 0;
}

export class AccountExistsError extends Error {
  readonly code = "account_exists";

  constructor(readonly email: string) {
    super("This email already has an account. Sign in to continue.");
    this.name = "AccountExistsError";
  }
}

export function isAccountExistsError(err: unknown): err is AccountExistsError {
  return (
    err instanceof AccountExistsError ||
    (typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "account_exists")
  );
}

export function loginUrlForExistingAccount(email: string, redirect = "/workspaces"): string {
  const params = new URLSearchParams({
    email,
    existing: "1",
    redirect,
  });
  return `/login?${params.toString()}`;
}

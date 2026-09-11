import { describe, expect, it } from "vitest";
import {
  AccountExistsError,
  isAccountExistsError,
  isAuthEntryPath,
  isSignupAliasPath,
  loginUrlForExistingAccount,
  SIGNUP_PATH,
  signupIndicatesExistingAccount,
  signedInAuthEntryDestination,
} from "./auth-entry";

describe("auth entry paths", () => {
  it("treats /signup as the canonical Start for Free URL", () => {
    expect(SIGNUP_PATH).toBe("/signup");
    expect(isAuthEntryPath("/signup")).toBe(true);
    expect(isSignupAliasPath("/register")).toBe(true);
    expect(isSignupAliasPath("/sign-up")).toBe(true);
    expect(isSignupAliasPath("/signup")).toBe(false);
  });

  it("sends a signed-in visitor on /signup to /workspaces", () => {
    expect(signedInAuthEntryDestination("/signup", null)).toBe("/workspaces");
    expect(signedInAuthEntryDestination("/register", null)).toBe("/workspaces");
    expect(signedInAuthEntryDestination("/login", null)).toBe("/workspaces");
  });

  it("lets a signed-in invitee continue to the invite instead of workspaces", () => {
    expect(signedInAuthEntryDestination("/signup", "/invite/abc")).toBe("/invite/abc");
  });

  it("does not redirect non-auth routes", () => {
    expect(signedInAuthEntryDestination("/workspaces", null)).toBeNull();
  });
});

describe("existing account on signup", () => {
  it("detects the Supabase already-registered error", () => {
    expect(
      signupIndicatesExistingAccount({
        error: { message: "User already registered", code: "user_already_exists" },
      })
    ).toBe(true);
  });

  it("detects the confirm-email identities=[] obfuscation", () => {
    expect(
      signupIndicatesExistingAccount({
        error: null,
        session: null,
        user: { identities: [] },
      })
    ).toBe(true);
  });

  it("does not treat a new unconfirmed signup as an existing account", () => {
    expect(
      signupIndicatesExistingAccount({
        error: null,
        session: null,
        user: { identities: [{ provider: "email" }] },
      })
    ).toBe(false);
  });

  it("does not treat a missing identities field as existing", () => {
    expect(
      signupIndicatesExistingAccount({
        error: null,
        session: null,
        user: { identities: null },
      })
    ).toBe(false);
  });

  it("builds the sign-in URL without granting credits", () => {
    expect(loginUrlForExistingAccount("a@b.com")).toContain("/login?");
    expect(loginUrlForExistingAccount("a@b.com")).toContain("existing=1");
    expect(loginUrlForExistingAccount("a@b.com")).toContain("email=a%40b.com");
    expect(isAccountExistsError(new AccountExistsError("a@b.com"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  displayNameFromEmail,
  inviteRedirectAfterAuth,
  inviteTokenFromPath,
  needsAccountSetupFromSignals,
} from "./account-setup";

const newInvitee = {
  membershipCount: 0,
  ownedWorkspaceCount: 0,
  hasPassword: false,
  oauthProviders: ["email"],
};

describe("needsAccountSetupFromSignals", () => {
  it("sends invite-created users to account setup", () => {
    expect(needsAccountSetupFromSignals(newInvitee)).toBe(true);
    expect(needsAccountSetupFromSignals({ ...newInvitee, oauthProviders: [] })).toBe(true);
  });

  it("skips setup when the email already has an account", () => {
    expect(
      needsAccountSetupFromSignals({ ...newInvitee, membershipCount: 1 })
    ).toBe(false);
    expect(
      needsAccountSetupFromSignals({ ...newInvitee, ownedWorkspaceCount: 1 })
    ).toBe(false);
    expect(needsAccountSetupFromSignals({ ...newInvitee, hasPassword: true })).toBe(false);
    expect(
      needsAccountSetupFromSignals({ ...newInvitee, oauthProviders: ["google"] })
    ).toBe(false);
  });
});

describe("inviteRedirectAfterAuth", () => {
  it("sends only unfinished accounts to /setup", () => {
    expect(inviteRedirectAfterAuth("/invite/abc123", true, null)).toBe(
      "/invite/abc123/setup"
    );
    expect(inviteRedirectAfterAuth("/invite/abc123/setup", true, null)).toBe(
      "/invite/abc123/setup"
    );
    expect(inviteRedirectAfterAuth("/invite/abc123", false, null)).toBe(
      "/invite/abc123"
    );
    expect(inviteRedirectAfterAuth("/invite/abc123/setup", false, null)).toBe(
      "/invite/abc123"
    );
  });

  it("does not hijack existing users with a pending invite", () => {
    expect(inviteRedirectAfterAuth("/workspaces", false, "abc123")).toBeNull();
  });

  it("sends unfinished accounts with a pending invite to setup", () => {
    expect(inviteRedirectAfterAuth("/workspaces", true, "abc123")).toBe(
      "/invite/abc123/setup"
    );
  });
});

describe("inviteTokenFromPath", () => {
  it("reads the invite token from invite and setup URLs", () => {
    expect(inviteTokenFromPath("/invite/abc123")).toBe("abc123");
    expect(inviteTokenFromPath("/invite/abc123/setup")).toBe("abc123");
    expect(inviteTokenFromPath("/workspaces")).toBeNull();
  });
});

describe("displayNameFromEmail", () => {
  it("turns the local part into a readable name", () => {
    expect(displayNameFromEmail("john.doe@example.com")).toBe("John Doe");
    expect(displayNameFromEmail("leenzein2024@gmail.com")).toBe("Leenzein2024");
    expect(displayNameFromEmail("")).toBe("");
  });
});

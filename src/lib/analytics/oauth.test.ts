import { afterEach, describe, expect, it } from "vitest";
import {
  createAnalyticsOAuthState,
  googleAnalyticsOAuthConfigured,
  verifyAnalyticsOAuthState,
} from "./oauth";

describe("analytics oauth state", () => {
  afterEach(() => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.GOOGLE_ANALYTICS_CLIENT_ID;
    delete process.env.GOOGLE_ANALYTICS_CLIENT_SECRET;
  });

  it("round-trips a signed state", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "a".repeat(64);
    const raw = createAnalyticsOAuthState({
      workspaceId: "ws-1",
      slug: "abc",
      type: "search-console",
      userId: "user-1",
    });
    expect(verifyAnalyticsOAuthState(raw)).toMatchObject({
      workspaceId: "ws-1",
      slug: "abc",
      type: "search-console",
      userId: "user-1",
    });
  });

  it("rejects a tampered payload", () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = "a".repeat(64);
    const raw = createAnalyticsOAuthState({
      workspaceId: "ws-1",
      slug: "abc",
      type: "google-analytics",
      userId: "user-1",
    });
    const [encoded, sig] = raw.split(".");
    const tampered = Buffer.from(
      JSON.stringify({
        workspaceId: "other",
        slug: "abc",
        type: "google-analytics",
        userId: "user-1",
        exp: Date.now() + 60_000,
      })
    ).toString("base64url");
    expect(verifyAnalyticsOAuthState(`${tampered}.${sig}`)).toBeNull();
    expect(verifyAnalyticsOAuthState(`${encoded}.deadbeef`)).toBeNull();
  });

  it("reports when Google OAuth env is missing", () => {
    expect(googleAnalyticsOAuthConfigured()).toBe(false);
    process.env.GOOGLE_ANALYTICS_CLIENT_ID = "id";
    process.env.GOOGLE_ANALYTICS_CLIENT_SECRET = "secret";
    expect(googleAnalyticsOAuthConfigured()).toBe(true);
  });
});

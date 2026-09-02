import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifySupabaseAccessToken } from "./verify-jwt";

function sign(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

describe("verifySupabaseAccessToken", () => {
  const secret = "test-jwt-secret";

  it("accepts a valid HS256 token", () => {
    const token = sign(
      { sub: "user-1", email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 60 },
      secret
    );
    expect(verifySupabaseAccessToken(token, secret)).toEqual(
      expect.objectContaining({ sub: "user-1", email: "a@b.c" })
    );
  });

  it("rejects a forged signature", () => {
    const token = sign({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }, secret);
    expect(verifySupabaseAccessToken(token, "other-secret")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = sign(
      { sub: "user-1", exp: Math.floor(Date.now() / 1000) - 10 },
      secret
    );
    expect(verifySupabaseAccessToken(token, secret)).toBeNull();
  });
});

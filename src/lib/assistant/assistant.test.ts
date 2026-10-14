import { describe, expect, it } from "vitest";
import {
  assistantEventSchema,
  browserActionSchema,
  isAllowedNavigation,
  isBlockedNavigation,
  chatRequestSchema,
} from "./protocol";
import { consumeApproval, issueApproval } from "./driver/spend-guard";
import { signServiceRequest } from "./service-client";

describe("assistant protocol", () => {
  it("accepts known events and rejects unknown ones", () => {
    expect(assistantEventSchema.safeParse({ type: "text", text: "hi" }).success).toBe(true);
    expect(assistantEventSchema.safeParse({ type: "usage", tokens: 5 }).success).toBe(false);
  });

  it("rejects malformed control ids", () => {
    expect(browserActionSchema.safeParse({ kind: "click", target: "ci.run" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "click", target: "x\"] , body" }).success).toBe(false);
    expect(browserActionSchema.safeParse({ kind: "shell", cmd: "ls" }).success).toBe(false);
  });

  it("limits message size", () => {
    const context = { workspaceSlug: "a", workspaceId: "w", path: "/w/a" };
    expect(chatRequestSchema.safeParse({ message: "x".repeat(4001), context }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "ok", context }).success).toBe(true);
  });

  it("confines navigation to the workspace and away from billing", () => {
    expect(isAllowedNavigation("/w/acme/catalog-intelligence/new", "acme")).toBe(true);
    expect(isAllowedNavigation("/w/acme", "acme")).toBe(true);
    expect(isAllowedNavigation("/w/acme-evil/x", "acme")).toBe(false);
    expect(isAllowedNavigation("https://evil.com", "acme")).toBe(false);
    expect(isBlockedNavigation("/w/acme/subscription/billing")).toBe(true);
    expect(isBlockedNavigation("/w/acme/catalog-intelligence")).toBe(false);
  });
});

describe("spend guard", () => {
  it("honours a token once, for its own control only", () => {
    const token = issueApproval("ci.run");
    expect(consumeApproval("ci.stop", token)).toBe(false);
    // A wrong-target attempt burns the token, so it cannot be retried elsewhere.
    expect(consumeApproval("ci.run", token)).toBe(false);
    const fresh = issueApproval("ci.run");
    expect(consumeApproval("ci.run", fresh)).toBe(true);
    expect(consumeApproval("ci.run", fresh)).toBe(false);
  });

  it("rejects missing and invented tokens", () => {
    expect(consumeApproval("ci.run", undefined)).toBe(false);
    expect(consumeApproval("ci.run", "deadbeef")).toBe(false);
  });
});

describe("service signing", () => {
  it("is deterministic and depends on every field", () => {
    const base = { secret: "s".repeat(40), timestamp: 1, userId: "u", method: "POST", path: "/runs", body: "{}" };
    const a = signServiceRequest(base);
    expect(signServiceRequest(base)).toBe(a);
    expect(signServiceRequest({ ...base, userId: "v" })).not.toBe(a);
    expect(signServiceRequest({ ...base, body: "{ }" })).not.toBe(a);
  });
});

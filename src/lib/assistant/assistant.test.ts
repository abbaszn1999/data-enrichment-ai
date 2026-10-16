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
    expect(assistantEventSchema.safeParse({ type: "summary", status: "completed" }).success).toBe(true);
    expect(assistantEventSchema.safeParse({ type: "context", usedTokens: 10, windowTokens: 200 }).success).toBe(true);
    expect(assistantEventSchema.safeParse({ type: "context", usedTokens: 10, windowTokens: 0 }).success).toBe(false);
  });

  it("rejects malformed control ids", () => {
    expect(browserActionSchema.safeParse({ kind: "click", target: "ci.run" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "click", target: "x\"] , body" }).success).toBe(false);
    expect(browserActionSchema.safeParse({ kind: "shell", cmd: "ls" }).success).toBe(false);
  });

  it("accepts gallery page actions only for known scopes", () => {
    expect(browserActionSchema.safeParse({ kind: "click", target: "gallery.project.3f2a9c1e-0b4d-4c55-9a1e-2b7f0c8d9e10" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_get_state", scope: "gallery" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_select_rows", scope: "gallery", mode: "status", statuses: ["failed"] }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_get_state", scope: "billing" }).success).toBe(false);
    expect(browserActionSchema.safeParse({ kind: "page_get_state", scope: "visualizer" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_set_columns", scope: "visualizer", columns: ["Title", "Brand"] }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_set_columns", scope: "gallery", columns: ["Title"] }).success).toBe(false);
    expect(browserActionSchema.safeParse({ kind: "page_select_rows", scope: "gallery", mode: "indexes", indexes: [0] }).success).toBe(false);
  });

  it("accepts the classification scope and multi-file uploads", () => {
    expect(browserActionSchema.safeParse({ kind: "page_get_state", scope: "classify" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_get_state", scope: "website" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_get_state", scope: "store" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_select_rows", scope: "store", mode: "all" }).success).toBe(false);
    expect(browserActionSchema.safeParse({ kind: "page_set_columns", scope: "website", columns: ["x"] }).success).toBe(false);
    expect(browserActionSchema.safeParse({ kind: "click", target: "website.competitor.remove.0" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "page_select_rows", scope: "classify", mode: "all" }).success).toBe(false);
    expect(browserActionSchema.safeParse({ kind: "upload_file", target: "classify.new.file", fileIds: ["a", "b"] }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "upload_file", target: "visualizer.create.file", fileId: "a" }).success).toBe(true);
    expect(
      browserActionSchema.safeParse({ kind: "upload_file", target: "classify.new.file", fileIds: Array.from({ length: 201 }, (_, i) => `f${i}`) }).success,
    ).toBe(false);
  });

  it("accepts list_projects for known tools only", () => {
    expect(browserActionSchema.safeParse({ kind: "list_projects" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "list_projects", tool: "catalog" }).success).toBe(true);
    expect(browserActionSchema.safeParse({ kind: "list_projects", tool: "billing" }).success).toBe(false);
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

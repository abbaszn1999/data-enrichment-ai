import { describe, expect, it } from "vitest";
import { jobHref, jobKindLabel } from "./href";
import { JOB_BATCH_SIZE, JOB_TASK_PLAN, SESSION_TIMEOUT_SECONDS } from "./config";

describe("jobHref", () => {
  it("builds catalog, gallery, and visualizer deep links", () => {
    expect(
      jobHref({
        kind: "catalog",
        workspaceSlug: "acme",
        sessionId: "sess-1",
      })
    ).toBe("/w/acme/catalog-intelligence/sess-1");
    expect(
      jobHref({
        kind: "gallery",
        workspaceSlug: "acme",
        sessionId: "abc",
      })
    ).toBe("/w/acme/products-gallery?project=abc");
    expect(
      jobHref({
        kind: "visualizer",
        workspaceSlug: "acme",
        sessionId: "xyz",
      })
    ).toBe("/w/acme/products-visualizer?project=xyz");
    expect(
      jobHref({
        kind: "mr_extract",
        workspaceSlug: "acme",
        sessionId: "extract-1",
      })
    ).toBe("/w/acme/market-research");
  });

  it("labels tools for the inbox", () => {
    expect(jobKindLabel("catalog")).toBe("Catalog Intelligence");
    expect(jobKindLabel("gallery")).toBe("Products Gallery");
    expect(jobKindLabel("mr_extract")).toBe("Market Research");
  });
});

describe("job scale knobs", () => {
  it("keeps startup-safe defaults that can be raised later", () => {
    expect(JOB_BATCH_SIZE).toBeGreaterThanOrEqual(4);
    expect(JOB_TASK_PLAN).toBe("flex");
    expect(SESSION_TIMEOUT_SECONDS).toBe(86_400);
  });
});

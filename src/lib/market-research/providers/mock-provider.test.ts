import { describe, expect, it } from "vitest";
import { createMockKeywordProvider } from "./mock-provider";

describe("mock keyword provider", () => {
  it("returns keyword_ideas_total for seed metrics", async () => {
    const provider = createMockKeywordProvider();
    const [metrics] = await provider.fetchSeedMetrics(["Sunglasses"], "us");
    expect(metrics.seed).toBe("Sunglasses");
    expect(metrics.keywordIdeasTotal).toBeGreaterThan(100);
  });

  it("pages keyword ideas through a cursor until succeeded", async () => {
    const provider = createMockKeywordProvider();
    const handle = await provider.startKeywordIdeas("Sunglasses", "us", 2);
    expect(handle.runId.startsWith("mock:")).toBe(true);

    let cursor: string | undefined;
    let rows = 0;
    let status = "running";
    for (let i = 0; i < 40 && status === "running"; i += 1) {
      const poll = await provider.pollKeywordIdeas(handle, cursor);
      rows += poll.rows.length;
      cursor = poll.nextCursor;
      status = poll.status;
      if (status === "running") {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    expect(status).toBe("succeeded");
    expect(rows).toBeGreaterThan(0);
  });
});

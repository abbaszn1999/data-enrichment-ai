import { describe, expect, it } from "vitest";
import type { ChatFile, Plan } from "./api";
import { buildSections, timeAgo } from "./file-browser";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const file = (id: string, path: string, minutesAgo: number, extra: Partial<ChatFile> = {}): ChatFile => ({
  id,
  name: path.split("/").pop()!,
  kind: "report",
  mime: "text/plain",
  size: 1,
  created_by: "agent",
  created_at: at(minutesAgo),
  path,
  shown: true,
  ...extra,
});

describe("Files panel folders", () => {
  it("puts each file in its folder, newest first, numbering repeated names", () => {
    const files = [
      file("u1", "uploads/a-kaystore.xlsx", 30, { created_by: "user", name: "kaystore.xlsx" }),
      file("u2", "uploads/b-kaystore.xlsx", 5, { created_by: "user", name: "kaystore.xlsx" }),
      file("r1", "reports/seo.md", 20, { request: "SEO audit" }),
      file("t1", "exports/products.csv", 10),
      file("w1", "exports/products.jsonl", 10, { shown: false }),
      file("x1", "attachments/kaystore.csv", 5),
    ];
    const plans: Plan[] = [{ id: "p1", title: "Pricing", content: "# Pricing", version: 2, status: "draft", build_run_id: null, updated_at: at(1) }];
    const sections = buildSections(files, plans, NOW);

    expect(sections.get("uploads")!.map((e) => [e.key, e.version])).toEqual([
      ["u2", "v2"],
      ["u1", "v1"],
    ]);
    expect(sections.get("reports")!.map((e) => e.detail)).toEqual(["20 minutes ago · SEO audit"]);
    expect(sections.get("store_data")!.map((e) => e.key)).toEqual(["t1"]);
    expect(sections.get("working")!.map((e) => e.key)).toEqual(["w1"]);
    expect(sections.get("plans")!.map((e) => [e.openId, e.detail])).toEqual([["plan:p1", "1 minute ago · Draft · version 2"]]);
    // Made from an upload: opened from the upload, not listed on its own.
    expect([...sections.values()].flat().some((e) => e.key === "x1")).toBe(false);
  });

  it("says how long ago in words", () => {
    expect(timeAgo(NOW - 10_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 3 * 3600_000, NOW)).toBe("3 hours ago");
  });
});

import { describe, expect, it } from "vitest";
import type { SyncSheetRow } from "@/lib/sync/core/types";
import {
  DIRECTORY_EDGE_SAMPLE,
  DIRECTORY_FULL_MAX,
  buildProductDirectory,
  formatSheetSampleForPrompt,
  sanitizeSheetSample,
} from "./injection-guards";

function row(title: string, extras: Partial<SyncSheetRow> = {}): SyncSheetRow {
  return { title, ...extras };
}

function makeRows(n: number): SyncSheetRow[] {
  return Array.from({ length: n }, (_, i) => row(`Product ${i}`));
}

describe("buildProductDirectory tiers", () => {
  it("returns a complete directory for small sheets", () => {
    const rows = makeRows(33);
    const dir = buildProductDirectory(rows);
    expect(dir.directoryComplete).toBe(true);
    expect(dir.directoryTotal).toBe(33);
    expect(dir.directoryShown).toBe(33);
    expect(dir.productDirectory[13]?.t).toBe("Product 13");
  });

  it("keeps a full directory up to DIRECTORY_FULL_MAX", () => {
    const rows = makeRows(DIRECTORY_FULL_MAX);
    const dir = buildProductDirectory(rows);
    expect(dir.directoryComplete).toBe(true);
    expect(dir.directoryShown).toBe(DIRECTORY_FULL_MAX);
    expect(dir.directoryNote).toMatch(/ALWAYS call sync_catalog_lookup/i);
  });

  it("truncates to first+last edges when larger than DIRECTORY_FULL_MAX", () => {
    const rows = makeRows(DIRECTORY_FULL_MAX + 500);
    const dir = buildProductDirectory(rows);
    expect(dir.directoryComplete).toBe(false);
    expect(dir.directoryTotal).toBe(DIRECTORY_FULL_MAX + 500);
    expect(dir.directoryShown).toBe(DIRECTORY_EDGE_SAMPLE * 2);
    expect(dir.productDirectory[0]?.i).toBe(0);
    expect(dir.productDirectory.at(-1)?.i).toBe(DIRECTORY_FULL_MAX + 499);
    expect(dir.directoryNote).toMatch(/truncated/i);
  });
});

describe("sanitizeSheetSample", () => {
  it("limits shape sampleRows to 2 and includes directory flags", () => {
    const sheet = {
      title: "Products",
      columns: ["title", "vendor"],
      rows: makeRows(10),
    };
    const sample = sanitizeSheetSample(sheet);
    expect(sample).not.toBeNull();
    expect(sample!.sampleRows).toHaveLength(2);
    expect(sample!.directoryComplete).toBe(true);
    expect(sample!.productDirectory).toHaveLength(10);

    const formatted = formatSheetSampleForPrompt(sample!);
    expect(formatted).toContain("[9] Product 9");
    expect(formatted).toContain("directoryComplete");
  });
});

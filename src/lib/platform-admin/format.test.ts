import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats bytes through terabytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(531)).toBe("531 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(42_996_998)).toBe("41.0 MB");
    expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
  });

  it("returns an em dash for invalid values", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

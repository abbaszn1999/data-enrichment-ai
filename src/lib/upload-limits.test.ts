import { describe, expect, it } from "vitest";
import {
  assertRowCount,
  assertSpreadsheetFile,
  maxBytesFor,
  spreadsheetKind,
  UploadLimitError,
} from "./upload-limits";

describe("upload limits", () => {
  it("rejects macro-enabled workbooks", () => {
    expect(spreadsheetKind("catalog.xlsm")).toBe("invalid");
    expect(() =>
      assertSpreadsheetFile({ name: "catalog.xlsm", size: 100 }, "products")
    ).toThrow(UploadLimitError);
  });

  it("enforces file size before parse", () => {
    expect(() =>
      assertSpreadsheetFile({ name: "a.xlsx", size: 26 * 1024 * 1024 }, "products")
    ).toThrow(/too large/i);
    expect(() =>
      assertSpreadsheetFile({ name: "a.csv", size: 26 * 1024 * 1024 }, "products")
    ).not.toThrow();
  });

  it("caps rows per flow", () => {
    expect(() => assertRowCount(50_001, "products")).toThrow(/50,000/);
    expect(() => assertRowCount(5_001, "gallery")).toThrow(/5,000/);
    expect(() => assertRowCount(5_001, "visualizer")).toThrow(/5,000/);
    expect(() => assertRowCount(5_000, "visualizer")).not.toThrow();
  });

  it("uses the CSV ceiling when the name ends in .csv", () => {
    expect(maxBytesFor("catalogIntelligence", "file.csv")).toBe(60 * 1024 * 1024);
    expect(maxBytesFor("catalogIntelligence", "file.xlsx")).toBe(30 * 1024 * 1024);
  });
});

import { describe, expect, it } from "vitest";
import { decodeStoragePath, encodeStoragePath } from "./storage-key";

const STORAGE_KEY = /^[\w/!\-.*'() &$@=;:+,?]+$/;

describe("storage keys", () => {
  it("keeps plain paths as they are", () => {
    expect(encodeStoragePath("outputs/audit-products.csv")).toBe("outputs/audit-products.csv");
  });

  it("keeps a folder prefix a prefix", () => {
    // ChatFiles matches a chat's stored files by `${ws}/${chat}/${encodeStoragePath("")}`.
    expect(encodeStoragePath("")).toBe("");
    expect(encodeStoragePath("reports/")).toBe("reports/");
  });

  it("stores names in any language as valid keys and reads them back exactly", () => {
    for (const name of ["تقرير-تدقيق-المتجر.md", "reports/خطة 2026.md", "uploads/abc-منتجات (1).csv", "café.png", "u8.trick"]) {
      const key = encodeStoragePath(name);
      expect(key).toMatch(STORAGE_KEY);
      expect(decodeStoragePath(key)).toBe(name);
    }
  });
});

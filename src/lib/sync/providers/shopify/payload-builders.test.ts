import { describe, expect, it } from "vitest";
import type { SyncSheetRow } from "@/lib/sync/core/types";
import { buildProductSetInput } from "./payload-builders";

const seoRow: SyncSheetRow = {
  id: "gid://shopify/Product/1",
  title: "Galaxy Pulse X1 Pro",
  handle: "galaxy-pulse-x1-pro",
  seo_title: "عنوان SEO",
  seo_description: "وصف SEO",
};

describe("buildProductSetInput identifier contract", () => {
  it("keeps handle in the input when only SEO changed", () => {
    const built = buildProductSetInput(seoRow, {
      changedColumns: ["seo_title", "seo_description"],
    });

    expect(built.identifier).toEqual({ handle: "galaxy-pulse-x1-pro" });
    expect(built.input.handle).toBe("galaxy-pulse-x1-pro");
  });

  it("keeps handle in the input for any narrow update", () => {
    const built = buildProductSetInput(
      { ...seoRow, vendor: "Autommerce" },
      { changedColumns: ["vendor"] }
    );

    expect(built.input.handle).toBe("galaxy-pulse-x1-pro");
    expect(built.input.vendor).toBe("Autommerce");
  });
});

describe("buildProductSetInput SEO payload", () => {
  it("sends both SEO fields when only the title changed", () => {
    const built = buildProductSetInput(seoRow, { changedColumns: ["seo_title"] });

    expect(built.input.seo).toEqual({
      title: "عنوان SEO",
      description: "وصف SEO",
    });
  });

  it("sends both SEO fields when only the description changed", () => {
    const built = buildProductSetInput(seoRow, {
      changedColumns: ["seo_description"],
    });

    expect(built.input.seo).toEqual({
      title: "عنوان SEO",
      description: "وصف SEO",
    });
  });

  it("omits SEO entirely when no SEO column is involved", () => {
    const built = buildProductSetInput(seoRow, { changedColumns: ["vendor"] });

    expect(built.input.seo).toBeUndefined();
  });

  it("only sends the SEO half the sheet actually carries", () => {
    const { seo_description: _omitted, ...titleOnlyRow } = seoRow;
    const built = buildProductSetInput(titleOnlyRow, {
      changedColumns: ["seo_title"],
    });

    expect(built.input.seo).toEqual({ title: "عنوان SEO" });
  });
});

import { describe, expect, it } from "vitest";
import { CMS_CATEGORY_COLUMNS } from "@/types";
import {
  matchSheetColumn,
  mappedNonEmptyCount,
  suggestCategoryColumnMap,
} from "@/lib/categories/column-map";

const shopifyHeaders = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Sort Order",
  "Published",
];

describe("matchSheetColumn", () => {
  it("returns the real Shopify Title header, not the synonym title", () => {
    expect(matchSheetColumn(shopifyHeaders, ["title", "name"])).toBe("Title");
  });

  it("matches Body (HTML) to the body (html) synonym", () => {
    expect(
      matchSheetColumn(shopifyHeaders, ["body (html)", "body_html", "description"])
    ).toBe("Body (HTML)");
  });

  it("does not treat Handle as an id via a short id synonym", () => {
    expect(matchSheetColumn(shopifyHeaders, ["id"])).toBe("");
    expect(matchSheetColumn(shopifyHeaders, ["handle", "id"])).toBe("Handle");
  });

  it("matches a BOM-prefixed Handle header", () => {
    expect(
      matchSheetColumn(["\uFEFFHandle", "Title"], ["handle", "id"])
    ).toBe("\uFEFFHandle");
  });
});

describe("suggestCategoryColumnMap", () => {
  it("maps a Shopify collections export onto name, description, and handle", () => {
    const mapped = suggestCategoryColumnMap(
      shopifyHeaders,
      CMS_CATEGORY_COLUMNS.shopify
    );
    expect(mapped).toEqual({
      name: "Title",
      parent: "",
      description: "Body (HTML)",
      id: "Handle",
    });
  });

  it("does not reuse Title for two fields", () => {
    const mapped = suggestCategoryColumnMap(["Title", "Name"], {
      nameColumns: ["title", "name"],
      parentColumns: ["title"],
      descColumns: [],
      idColumns: [],
      hint: "",
    });
    expect(mapped.name).toBe("Title");
    expect(mapped.parent).toBe("");
  });

  it("fills Shopify Body/Handle even when the workspace CMS is custom", () => {
    expect(
      suggestCategoryColumnMap(shopifyHeaders, CMS_CATEGORY_COLUMNS.custom)
    ).toEqual({
      name: "Title",
      parent: "",
      description: "Body (HTML)",
      id: "Handle",
    });
  });

  it("extracts Arabic names from Title after mapping (not the synonym title)", () => {
    const rows = [
      { Handle: "audio", Title: "السماعات والصوتيات" },
      { Handle: "phones", Title: "الهواتف الذكية" },
    ];
    const mapped = suggestCategoryColumnMap(
      ["Handle", "Title"],
      CMS_CATEGORY_COLUMNS.shopify
    );
    expect(mapped.name).toBe("Title");
    expect(mappedNonEmptyCount(rows, mapped.name)).toBe(2);
    expect(mappedNonEmptyCount(rows, "title")).toBe(0);
  });
});

describe("mappedNonEmptyCount", () => {
  it("counts rows that have a value in the mapped column", () => {
    const rows = [
      { Title: "السماعات والصوتيات" },
      { Title: "" },
      { Title: "الهواتف الذكية" },
    ];
    expect(mappedNonEmptyCount(rows, "title")).toBe(0);
    expect(mappedNonEmptyCount(rows, "Title")).toBe(2);
  });
});

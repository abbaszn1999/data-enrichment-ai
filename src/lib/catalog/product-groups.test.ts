import { describe, expect, it } from "vitest";
import {
  applyPrimaryEnrichmentToGroup,
  buildProductGroupIndex,
  collapseToPrimaryRowIds,
  countGroupedMatchTypes,
  expandToGroupMemberIds,
  partitionRowsForExport,
  resolveProductGroupColumn,
  suggestProductGroupColumn,
  visibleCatalogRows,
  type GroupableRow,
} from "./product-groups";

function row(
  id: string,
  data: Record<string, string>,
  extra?: Partial<GroupableRow>
): GroupableRow {
  return {
    id,
    rowIndex: extra?.rowIndex ?? Number(id.replace(/\D/g, "") || 0),
    originalData: data,
    matchType: extra?.matchType ?? "new",
    status: extra?.status ?? "pending",
    enrichedData: extra?.enrichedData ?? {},
    ...extra,
  };
}

const SHOPIFY_COLUMNS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Option1 Value",
  "Variant SKU",
];

describe("suggestProductGroupColumn", () => {
  it("suggests Handle when values repeat", () => {
    const rows = [
      row("1", { Handle: "camisole-navy", Title: "Camisole" }),
      row("2", { Handle: "camisole-navy", Title: "" }),
      row("3", { Handle: "other", Title: "Other" }),
    ];
    expect(suggestProductGroupColumn(SHOPIFY_COLUMNS, rows)).toBe("Handle");
  });

  it("does not suggest Handle when every value is unique", () => {
    const rows = [
      row("1", { Handle: "a", Title: "A" }),
      row("2", { Handle: "b", Title: "B" }),
    ];
    expect(suggestProductGroupColumn(["Handle", "Title"], rows)).toBeNull();
  });

  it("does not suggest SKU even when SKUs repeat", () => {
    const rows = [
      row("1", { SKU: "dup", Title: "A" }),
      row("2", { SKU: "dup", Title: "B" }),
    ];
    expect(suggestProductGroupColumn(["SKU", "Title"], rows)).toBeNull();
  });
});

describe("resolveProductGroupColumn", () => {
  const rows = [
    row("1", { Handle: "a", Title: "A" }),
    row("2", { Handle: "a", Title: "" }),
  ];

  it("auto-detects when saved is undefined", () => {
    expect(
      resolveProductGroupColumn({
        columns: ["Handle", "Title"],
        rows,
      })
    ).toBe("Handle");
  });

  it("keeps grouping off when the user saved null", () => {
    expect(
      resolveProductGroupColumn({
        saved: null,
        columns: ["Handle", "Title"],
        rows,
      })
    ).toBeNull();
  });

  it("never groups PLP sessions", () => {
    expect(
      resolveProductGroupColumn({
        columns: ["Handle", "Title"],
        rows,
        kind: "plp",
      })
    ).toBeNull();
  });

  it("maps a saved name onto the real header casing", () => {
    expect(
      resolveProductGroupColumn({
        saved: "handle",
        columns: ["Handle", "Title"],
        rows,
      })
    ).toBe("Handle");
  });
});

describe("buildProductGroupIndex", () => {
  it("collapses Shopify variant rows onto the titled parent", () => {
    const rows = [
      row("1", {
        Handle: "s14-onl-li-4184l-navy",
        Title: "Delicious Camisole",
        "Body (HTML)": "<p>Nice</p>",
        "Option1 Value": "S",
      }),
      row("2", {
        Handle: "s14-onl-li-4184l-navy",
        Title: "",
        "Body (HTML)": "",
        "Option1 Value": "M",
      }),
      row("3", {
        Handle: "s14-onl-li-4184l-navy",
        Title: "",
        "Option1 Value": "L",
      }),
      row("4", {
        Handle: "s14-onl-li-4184l-navy",
        Title: "",
        "Option1 Value": "XL",
      }),
      row("5", { Handle: "other-product", Title: "Other", "Option1 Value": "S" }),
    ];
    const index = buildProductGroupIndex(rows, "Handle");
    expect(index.enabled).toBe(true);
    expect(index.primaryIds).toEqual(new Set(["1", "5"]));
    expect(index.sizeByPrimary.get("1")).toBe(4);
    expect(index.primaryIdByRowId.get("3")).toBe("1");
    expect(visibleCatalogRows(rows, { groupColumn: "Handle" }).map((r) => r.id)).toEqual([
      "1",
      "5",
    ]);
  });

  it("prefers the row that actually has the product title", () => {
    const rows = [
      row("1", { Handle: "x", Title: "", "Variant Title": "Navy" }),
      row("2", { Handle: "x", Title: "Real Product" }),
      row("3", { Handle: "x", Title: "" }),
    ];
    const index = buildProductGroupIndex(rows, "Handle");
    expect(index.primaryIdByRowId.get("1")).toBe("2");
    expect(index.primaryIds.has("2")).toBe(true);
  });

  it("does not merge blank handles into one product", () => {
    const rows = [
      row("1", { Handle: "", Title: "A" }),
      row("2", { Handle: "   ", Title: "B" }),
      row("3", { Handle: "kept", Title: "C" }),
      row("4", { Handle: "kept", Title: "" }),
    ];
    const index = buildProductGroupIndex(rows, "Handle");
    expect(index.primaryIds).toEqual(new Set(["1", "2", "3"]));
    expect(index.sizeByPrimary.get("1")).toBe(1);
    expect(index.sizeByPrimary.get("3")).toBe(2);
  });

  it("groups Handle values case-insensitively", () => {
    const rows = [
      row("1", { Handle: "Camisole", Title: "A" }),
      row("2", { Handle: "camisole", Title: "" }),
    ];
    const index = buildProductGroupIndex(rows, "Handle");
    expect(index.sizeByPrimary.get("1")).toBe(2);
  });
});

describe("visibleCatalogRows match tabs", () => {
  it("treats a group as existing if any variant matched", () => {
    const rows = [
      row("1", { Handle: "a", Title: "A" }, { matchType: "new" }),
      row("2", { Handle: "a", Title: "" }, { matchType: "existing" }),
      row("3", { Handle: "b", Title: "B" }, { matchType: "new" }),
    ];
    expect(
      visibleCatalogRows(rows, { groupColumn: "Handle", activeSheet: "existing" }).map(
        (r) => r.id
      )
    ).toEqual(["1"]);
    expect(
      visibleCatalogRows(rows, { groupColumn: "Handle", activeSheet: "new" }).map(
        (r) => r.id
      )
    ).toEqual(["3"]);
  });
});

describe("count / collapse / expand / fan-out", () => {
  const rows = [
    row("1", { Handle: "a", Title: "A" }),
    row("2", { Handle: "a", Title: "" }),
    row("3", { Handle: "a", Title: "" }),
    row("4", { Handle: "b", Title: "B" }),
  ];

  it("counts unique products after matching", () => {
    expect(countGroupedMatchTypes(rows, "Handle")).toEqual({
      existing: 0,
      new: 2,
      products: 2,
      rows: 4,
    });
  });

  it("collapses selected variant ids onto the primary once", () => {
    expect(collapseToPrimaryRowIds(["2", "3", "2", "4"], rows, "Handle")).toEqual([
      "1",
      "4",
    ]);
  });

  it("expands a deleted product to every variant row", () => {
    expect(expandToGroupMemberIds(["1"], rows, "Handle")).toEqual(["1", "2", "3"]);
  });

  it("copies enrichment onto siblings and marks them done", () => {
    const copy = rows.map((item) => ({
      ...item,
      enrichedData: { ...item.enrichedData },
    }));
    copy[0]!.enrichedData = { enhancedTitle: "Nice Camisole", imageUrls: ["x"] };
    copy[0]!.status = "done";

    const siblings = applyPrimaryEnrichmentToGroup(copy, "1", "Handle");
    expect(siblings).toEqual(["2", "3"]);
    expect(copy[1]!.status).toBe("done");
    expect(copy[2]!.enrichedData).toEqual({
      enhancedTitle: "Nice Camisole",
      imageUrls: ["x"],
    });
    expect(copy[3]!.status).toBe("pending");
    expect(copy[3]!.enrichedData).toEqual({});
  });

  it("does not fan out when grouping is off", () => {
    const copy = [row("1", { Title: "A" }, { enrichedData: { enhancedTitle: "X" } })];
    expect(applyPrimaryEnrichmentToGroup(copy, "1", null)).toEqual([]);
  });
});

describe("partitionRowsForExport", () => {
  it("keeps every variant row and parks the whole product on one sheet", () => {
    const rows = [
      row("1", { Handle: "a", Title: "A" }, { matchType: "new" }),
      row("2", { Handle: "a", Title: "" }, { matchType: "existing" }),
      row("3", { Handle: "b", Title: "B" }, { matchType: "new" }),
    ];
    const { existing, new: next } = partitionRowsForExport(rows, "Handle");
    expect(existing.map((r) => r.id)).toEqual(["1", "2"]);
    expect(next.map((r) => r.id)).toEqual(["3"]);
  });
});

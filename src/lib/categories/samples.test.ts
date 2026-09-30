import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CMS_CATEGORY_COLUMNS } from "@/types";
import { suggestCategoryColumnMap } from "./column-map";
import { buildIncomingCategories } from "./import";

// The sample sheets avoid commas inside values, so a plain split is enough.
function readSample(file: string) {
  const text = readFileSync(path.join(process.cwd(), "public", "samples", file), "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const columns = header.split(",");
  const rows = lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(columns.map((col, i) => [col, cells[i] ?? ""]));
  });
  return { columns, rows };
}

const pathOf = (cats: Array<{ id: string; name: string; parentId: string | null }>, name: string) => {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out: string[] = [];
  let cur = cats.find((c) => c.name === name);
  while (cur) {
    out.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out.join(" > ");
};

describe("sample sheets import cleanly with the suggested mapping", () => {
  it("Shopify collections sample is flat", () => {
    const { columns, rows } = readSample("shopify-collections-sample.csv");
    expect(columns).toEqual(["Title", "Handle", "Description"]);
    const mapping = suggestCategoryColumnMap(columns, CMS_CATEGORY_COLUMNS.shopify);
    expect(mapping).toMatchObject({ name: "Title", id: "Handle", description: "Description" });
    const result = buildIncomingCategories(rows, { ...mapping, parent: "" }, "flat");
    expect(result.categories).toHaveLength(rows.length);
    expect(result.categories.every((c) => c.parentId === null)).toBe(true);
    expect(result.skipped).toBe(0);
  });

  it("WooCommerce sample mixes Parent rows and Path rows, including 4 levels", () => {
    const { columns, rows } = readSample("woocommerce-categories-sample.csv");
    expect(columns).toEqual(["Name", "Slug", "Parent", "Description"]);
    const mapping = suggestCategoryColumnMap(columns, CMS_CATEGORY_COLUMNS.woocommerce);
    expect(mapping).toMatchObject({ name: "Name", parent: "Parent", id: "Slug", description: "Description" });
    const result = buildIncomingCategories(rows, mapping, "tree");
    expect(pathOf(result.categories, "Smartphones")).toBe("Electronics > Phones > Smartphones");
    expect(pathOf(result.categories, "Pots")).toBe("Home > Kitchen > Cookware > Pots");
    expect(pathOf(result.categories, "Pans")).toBe("Home > Kitchen > Cookware > Pans");
    expect(result.autoCreated).toBe(3); // Home, Kitchen, Cookware
    expect(result.skipped).toBe(0);
  });
});

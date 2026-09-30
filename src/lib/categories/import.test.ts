import { describe, expect, it } from "vitest";
import { buildIncomingCategories, splitCategoryPath, slugifyCategory } from "./import";

let counter = 0;
const newId = () => `id-${++counter}`;
const build = (
  rows: Array<Record<string, string>>,
  mapping: Partial<{ name: string; parent: string; description: string; id: string }>,
  structure: "flat" | "tree"
) => {
  counter = 0;
  return buildIncomingCategories(
    rows,
    { name: "", parent: "", description: "", id: "", ...mapping },
    structure,
    newId
  );
};

const pathOf = (cats: ReturnType<typeof build>["categories"], name: string) => {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out: string[] = [];
  let cur = cats.find((c) => c.name === name);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out.join(" > ");
};

describe("helpers", () => {
  it("splits and slugifies", () => {
    expect(splitCategoryPath("A >  B>C > ")).toEqual(["A", "B", "C"]);
    expect(slugifyCategory("Men's Shoes & Boots")).toBe("men-s-shoes-boots");
  });
});

describe("flat (Shopify collections)", () => {
  it("ignores the parent column and keeps names whole", () => {
    const result = build(
      [
        { Title: "Summer Sale", Handle: "summer-sale", Description: "Hot" },
        { Title: "Men > Shoes", Handle: "", Description: "", Parent: "Summer Sale" },
        { Title: "", Handle: "x" },
      ],
      { name: "Title", id: "Handle", description: "Description", parent: "Parent" },
      "flat"
    );
    expect(result.categories.map((c) => c.name)).toEqual(["Summer Sale", "Men > Shoes"]);
    expect(result.categories.every((c) => c.parentId === null)).toBe(true);
    expect(result.categories[0]).toMatchObject({ slug: "summer-sale", description: "Hot", originalId: "summer-sale" });
    expect(result.skipped).toBe(1);
  });

  it("skips repeated collections", () => {
    const result = build([{ Title: "Sale" }, { Title: "sale" }], { name: "Title" }, "flat");
    expect(result.categories).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});

describe("tree (WooCommerce)", () => {
  it("resolves Parent by name, even when the parent comes later", () => {
    const result = build(
      [
        { Name: "Phones", Parent: "Electronics" },
        { Name: "Electronics", Parent: "" },
        { Name: "Smartphones", Parent: "Phones" },
      ],
      { name: "Name", parent: "Parent" },
      "tree"
    );
    expect(pathOf(result.categories, "Smartphones")).toBe("Electronics > Phones > Smartphones");
    expect(result.categories).toHaveLength(3);
  });

  it("resolves Parent by id, slug and full path", () => {
    const result = build(
      [
        { Name: "Clothing", Slug: "clothing", Parent: "" },
        { Name: "Men", Slug: "men", Parent: "clothing" },
        { Name: "Shirts", Slug: "shirts", Parent: "Clothing > Men" },
        { Name: "Hats", Slug: "hats", Parent: "men" },
      ],
      { name: "Name", id: "Slug", parent: "Parent" },
      "tree"
    );
    expect(pathOf(result.categories, "Shirts")).toBe("Clothing > Men > Shirts");
    expect(pathOf(result.categories, "Hats")).toBe("Clothing > Men > Hats");
    expect(result.categories.find((c) => c.name === "Men")?.slug).toBe("men");
  });

  it("builds missing ancestors from a Path column", () => {
    const result = build(
      [{ Path: "A > B > C > D" }, { Path: "A > B > E" }, { Path: "A" }],
      { name: "Path" },
      "tree"
    );
    expect(result.categories.map((c) => c.name)).toEqual(["A", "B", "C", "D", "E"]);
    expect(pathOf(result.categories, "D")).toBe("A > B > C > D");
    expect(pathOf(result.categories, "E")).toBe("A > B > E");
    // "A" was listed explicitly after being auto-created -> merged, not duplicated.
    expect(result.categories.filter((c) => c.name === "A")).toHaveLength(1);
  });

  it("merges an explicit row into an auto-created ancestor and keeps its description", () => {
    const result = build(
      [{ Path: "A > B" }, { Path: "A", Description: "Top" }],
      { name: "Path", description: "Description" },
      "tree"
    );
    expect(result.categories).toHaveLength(2);
    expect(result.categories.find((c) => c.name === "A")?.description).toBe("Top");
    expect(result.autoCreated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("counts auto-created ancestors", () => {
    const result = build([{ Path: "A > B > C" }], { name: "Path" }, "tree");
    expect(result.autoCreated).toBe(2);
  });

  it("creates a parent that is only mentioned by name, and roots unknown numeric ids", () => {
    const result = build(
      [
        { Name: "Phones", Parent: "Electronics" },
        { Name: "Tablets", Parent: "77" },
        { Name: "Top", Parent: "0" },
      ],
      { name: "Name", parent: "Parent" },
      "tree"
    );
    expect(pathOf(result.categories, "Phones")).toBe("Electronics > Phones");
    expect(pathOf(result.categories, "Tablets")).toBe("Tablets");
    expect(pathOf(result.categories, "Top")).toBe("Top");
  });

  it("handles numeric ids for parents", () => {
    const result = build(
      [
        { name: "Shoes", id: "10", parent_id: "0" },
        { name: "Boots", id: "11", parent_id: "10" },
      ],
      { name: "name", id: "id", parent: "parent_id" },
      "tree"
    );
    expect(pathOf(result.categories, "Boots")).toBe("Shoes > Boots");
  });

  it("never creates cycles or self-parents", () => {
    const result = build(
      [
        { Name: "A", Parent: "B" },
        { Name: "B", Parent: "A" },
        { Name: "C", Parent: "C" },
      ],
      { name: "Name", parent: "Parent" },
      "tree"
    );
    const byId = new Map(result.categories.map((c) => [c.id, c]));
    for (const cat of result.categories) {
      const seen = new Set<string>();
      let cur: typeof cat | undefined = cat;
      while (cur) {
        expect(seen.has(cur.id)).toBe(false);
        seen.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    expect(result.categories).toHaveLength(3);
  });

  it("supports both shapes in one file with unlimited depth", () => {
    const result = build(
      [
        { Name: "Home", Parent: "" },
        { Name: "Kitchen", Parent: "Home" },
        { Name: "Cookware > Pots > Stock Pots > Enamel", Parent: "Kitchen" },
      ],
      { name: "Name", parent: "Parent" },
      "tree"
    );
    expect(pathOf(result.categories, "Enamel")).toBe("Home > Kitchen > Cookware > Pots > Stock Pots > Enamel");
  });

  it("keeps same-named categories under different parents", () => {
    const result = build([{ Path: "Men > Shoes" }, { Path: "Women > Shoes" }], { name: "Path" }, "tree");
    expect(result.categories.filter((c) => c.name === "Shoes")).toHaveLength(2);
  });
});

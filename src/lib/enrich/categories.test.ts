import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryItem } from "@/types";
import { buildCategoryItems } from "@/lib/categories/items";
import {
  categoryFormatsFor,
  categoryStructureFor,
  defaultCategoryFormat,
  resolveCategoryFormat,
} from "@/lib/categories/format";
import { calculateOpenAiWebSearchCost } from "@/lib/ai-pricing";
import {
  buildCategoryInstructions,
  parseCategoryAnswer,
  resolveCategoryPlan,
  sanitizeCategoriesOutput,
} from "./categories";
import { classifyProductCategories, isCategoriesModeRun } from "./categories-agent";

const item = (id: string, name: string, parentId: string | null, fullPath: string): CategoryItem => ({
  id,
  name,
  slug: name.toLowerCase(),
  parentId,
  fullPath,
});

const wooTree: CategoryItem[] = [
  item("1", "Clothing", null, "Clothing"),
  item("2", "Shirts", "1", "Clothing > Shirts"),
  item("3", "Polo Shirts", "2", "Clothing > Shirts > Polo Shirts"),
  item("4", "Accessories", null, "Accessories"),
  item("5", "Accessories", "1", "Clothing > Accessories"),
  item("6", "Pots, Pans & Lids", null, "Pots, Pans & Lids"),
];

const shopifyCollections: CategoryItem[] = [
  item("a", "Summer Sale", null, "Summer Sale"),
  item("b", "Pots, Pans & Lids", null, "Pots, Pans & Lids"),
  item("c", "New Arrivals", null, "New Arrivals"),
];

describe("platform formats", () => {
  it("Shopify is flat and only offers collections; WooCommerce offers three formats", () => {
    expect(categoryStructureFor("shopify")).toBe("flat");
    expect(categoryStructureFor("woocommerce")).toBe("tree");
    expect(categoryFormatsFor("shopify").map((o) => o.id)).toEqual(["collections"]);
    expect(categoryFormatsFor("woocommerce").map((o) => o.id)).toEqual(["flat", "depth2", "depth3"]);
    expect(defaultCategoryFormat("shopify")).toBe("collections");
    expect(defaultCategoryFormat("woocommerce")).toBe("depth2");
  });

  it("a saved format that does not fit the platform falls back to that platform's default", () => {
    expect(resolveCategoryFormat("shopify", "depth3")).toBe("collections");
    expect(resolveCategoryFormat("woocommerce", "collections")).toBe("depth2");
    expect(resolveCategoryFormat("woocommerce", "depth3")).toBe("depth3");
  });
});

describe("resolveCategoryPlan", () => {
  it("is store mode whenever the store has categories and the user has not turned them off", () => {
    expect(resolveCategoryPlan({ cmsType: "woocommerce", workspaceCategories: wooTree }).mode).toBe("store");
    expect(
      resolveCategoryPlan({ cmsType: "woocommerce", workspaceCategories: wooTree, useStoreCategories: false }).mode
    ).toBe("suggest");
    expect(resolveCategoryPlan({ cmsType: "woocommerce", workspaceCategories: [] }).mode).toBe("suggest");
    expect(resolveCategoryPlan({ cmsType: "woocommerce" }).mode).toBe("suggest");
  });

  it("even a single store category switches to store mode", () => {
    const plan = resolveCategoryPlan({ cmsType: "shopify", workspaceCategories: [shopifyCollections[0]] });
    expect(plan.mode).toBe("store");
    expect(plan.labels).toEqual(["Summer Sale"]);
  });

  it("uses names on Shopify and full paths on WooCommerce, without repeats, and never caps the list", () => {
    expect(resolveCategoryPlan({ cmsType: "shopify", workspaceCategories: wooTree }).labels).toContain("Shirts");
    const woo = resolveCategoryPlan({ cmsType: "woocommerce", workspaceCategories: wooTree });
    expect(woo.labels).toContain("Clothing > Shirts > Polo Shirts");
    expect(woo.labels).toContain("Clothing > Accessories");
    const many = Array.from({ length: 1200 }, (_, i) => item(String(i), `Cat ${i}`, null, `Cat ${i}`));
    expect(resolveCategoryPlan({ cmsType: "woocommerce", workspaceCategories: many }).labels).toHaveLength(1200);
  });

  it("clamps the per-product count to 1..5", () => {
    expect(resolveCategoryPlan({ cmsType: "woocommerce", maxCategories: 99 }).max).toBe(5);
    expect(resolveCategoryPlan({ cmsType: "woocommerce", maxCategories: 0 }).max).toBe(1);
    expect(resolveCategoryPlan({ cmsType: "woocommerce" }).max).toBe(3);
  });
});

describe("buildCategoryInstructions", () => {
  it("lists every store category, tells Shopify names apart from Woo paths, and forbids inventing", () => {
    const shop = buildCategoryInstructions(resolveCategoryPlan({ cmsType: "shopify", workspaceCategories: shopifyCollections }));
    expect(shop).toContain("flat collections");
    expect(shop).toContain("Summer Sale");
    expect(shop).not.toContain("Clothing >");
    expect(shop).toContain("Never invent");

    const woo = buildCategoryInstructions(resolveCategoryPlan({ cmsType: "woocommerce", workspaceCategories: wooTree }));
    expect(woo).toContain("MOST SPECIFIC");
    expect(woo).toContain("Clothing > Shirts > Polo Shirts");
    expect(woo).toContain("Allowed categories (6)");
  });

  it("gives each suggest format its own contract", () => {
    const text = (cmsType: string, categoryFormat: string) =>
      buildCategoryInstructions(resolveCategoryPlan({ cmsType, categoryFormat }));
    expect(text("shopify", "collections")).toContain("Suggest collections");
    expect(text("woocommerce", "flat")).toContain("flat categories");
    expect(text("woocommerce", "depth2")).toContain("at most 2 levels");
    expect(text("woocommerce", "depth3")).toContain("at most 3 levels");
    expect(text("woocommerce", "depth2")).not.toContain("Allowed categories");
  });

  it("includes the store owner's instruction and is identical for every row (cache friendly)", () => {
    const plan = resolveCategoryPlan({ cmsType: "woocommerce", workspaceCategories: wooTree });
    const a = buildCategoryInstructions(plan, { customInstruction: "Prefer the most specific level" });
    expect(a).toContain("Prefer the most specific level");
    expect(buildCategoryInstructions(plan, { customInstruction: "Prefer the most specific level" })).toBe(a);
  });
});

describe("parseCategoryAnswer, store mode", () => {
  const woo = resolveCategoryPlan({ cmsType: "woocommerce", workspaceCategories: wooTree, maxCategories: 3 });
  const shop = resolveCategoryPlan({ cmsType: "shopify", workspaceCategories: shopifyCollections, maxCategories: 3 });

  it("keeps exact paths, ignores case and spacing around arrows", () => {
    expect(parseCategoryAnswer("clothing>shirts >  Polo Shirts", woo).value).toBe("Clothing > Shirts > Polo Shirts");
  });

  it("maps a unique leaf name to its full path, but not an ambiguous one", () => {
    expect(parseCategoryAnswer("Polo Shirts", woo).value).toBe("Clothing > Shirts > Polo Shirts");
    // "Accessories" exists at two places: root and under Clothing. The root one is an exact match.
    expect(parseCategoryAnswer("Accessories", woo).value).toBe("Accessories");
    const dup = resolveCategoryPlan({
      cmsType: "woocommerce",
      workspaceCategories: [item("1", "A", null, "A"), item("2", "Sale", "1", "A > Sale"), item("3", "Sale", null, "B > Sale")],
    });
    expect(parseCategoryAnswer("Sale", dup).value).toBe("");
  });

  it("does not split a name that contains a comma", () => {
    expect(parseCategoryAnswer("Summer Sale, Pots, Pans & Lids", shop).value).toBe("Summer Sale, Pots, Pans & Lids");
    expect(parseCategoryAnswer("Pots, Pans & Lids", woo).value).toBe("Pots, Pans & Lids");
  });

  it("drops anything that is not in the list", () => {
    expect(parseCategoryAnswer("Summer Sale, Made Up Collection", shop).value).toBe("Summer Sale");
    const none = parseCategoryAnswer("Electronics > Phones", woo);
    expect(none.value).toBe("");
    expect(none.note).toContain("not in your store categories");
  });

  it("removes duplicates, drops a parent when its child is also chosen, and caps at the maximum", () => {
    expect(parseCategoryAnswer("Clothing, Clothing > Shirts, clothing > shirts", woo).value).toBe("Clothing > Shirts");
    const one = resolveCategoryPlan({ cmsType: "shopify", workspaceCategories: shopifyCollections, maxCategories: 1 });
    expect(parseCategoryAnswer("New Arrivals, Summer Sale", one).value).toBe("New Arrivals");
  });

  it("an empty answer becomes an empty cell with the model's reason or a default note", () => {
    expect(parseCategoryAnswer("", woo, "It is a book").note).toBe("It is a book");
    expect(parseCategoryAnswer("", woo).note).toBe("No store category fits this product.");
  });
});

describe("parseCategoryAnswer, suggest mode", () => {
  const suggest = (cmsType: string, categoryFormat: string, maxCategories = 3) =>
    resolveCategoryPlan({ cmsType, categoryFormat, maxCategories });

  it("collections: flat names only, a path is reduced to its last level", () => {
    const plan = suggest("shopify", "collections");
    expect(parseCategoryAnswer("Running Shoes, Summer Sale", plan).value).toBe("Running Shoes, Summer Sale");
    expect(parseCategoryAnswer("Shoes > Running Shoes", plan).value).toBe("Running Shoes");
  });

  it("depth 2 cuts anything deeper; depth 3 allows three levels", () => {
    expect(parseCategoryAnswer("Shoes > Sneakers > Running", suggest("woocommerce", "depth2")).value).toBe("Shoes > Sneakers");
    expect(parseCategoryAnswer("Shoes>Sneakers>Running>Trail", suggest("woocommerce", "depth3")).value).toBe(
      "Shoes > Sneakers > Running"
    );
  });

  it("removes repeats and parents already covered, and caps the count", () => {
    const plan = suggest("woocommerce", "depth3", 2);
    expect(parseCategoryAnswer("Shoes, Shoes > Sneakers, Bags, Hats", plan).value).toBe("Shoes > Sneakers, Bags");
  });

  it("empty suggestions carry a note", () => {
    expect(parseCategoryAnswer("", suggest("woocommerce", "flat")).note).toBe("No category could be suggested.");
  });
});

describe("sanitizeCategoriesOutput (shared with the combined-column path)", () => {
  it("still returns only allowed values when a list exists", () => {
    expect(
      sanitizeCategoriesOutput("Clothing > Shirts, Nope", { cmsType: "woocommerce", workspaceCategories: wooTree })
    ).toBe("Clothing > Shirts");
  });
});

describe("buildCategoryItems", () => {
  it("builds full paths of any depth and survives cycles and orphans", () => {
    const items = buildCategoryItems([
      { id: "a", name: "A", slug: "a", parentId: null },
      { id: "b", name: "B", slug: "b", parentId: "a" },
      { id: "c", name: "C", slug: "c", parentId: "b" },
      { id: "d", name: "D", slug: "d", parentId: "c" },
      { id: "x", name: "X", slug: "x", parentId: "y" },
      { id: "y", name: "Y", slug: "y", parentId: "x" },
      { id: "o", name: "Orphan", slug: "o", parentId: "gone" },
    ]);
    expect(items.find((i) => i.id === "d")!.fullPath).toBe("A > B > C > D");
    expect(items.find((i) => i.id === "o")!.fullPath).toBe("Orphan");
    expect(items.find((i) => i.id === "x")!.fullPath).toContain("X");
  });
});

describe("Categories mode agent: one call, GPT-6.1 Sol medium, no web search", () => {
  const usage = { input_tokens: 8_000, output_tokens: 300, input_tokens_details: { cached_tokens: 6_000 }, output_tokens_details: { reasoning_tokens: 200 } };
  const answer = (categories: string, reason = "") => ({
    status: "completed",
    usage,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ categories, reason }) }] }],
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => vi.unstubAllGlobals());

  const params = (extra: Record<string, unknown> = {}) => ({
    productData: { Title: "Polo shirt blue", Photo: "https://cdn.test/a.jpg" },
    enabledColumns: ["categories"],
    enrichmentColumns: [{ id: "categories", label: "Categories", description: "", type: "categories" as const, enabled: true, maxCategories: 2 }],
    settings: { enrichmentModel: "premium" as const, outputLanguage: "English" },
    cmsType: "woocommerce",
    workspaceCategories: wooTree,
    ...extra,
  });

  it("is recognised only for a run whose one column is categories", () => {
    expect(isCategoriesModeRun("product", ["categories"])).toBe(true);
    expect(isCategoriesModeRun("product", ["categories", "enhancedTitle"])).toBe(false);
    expect(isCategoriesModeRun("plp", ["categories"])).toBe(false);
  });

  it("sends gpt-6.1-sol with medium reasoning and no tools at all, whatever tier was saved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(answer("Clothing > Shirts > Polo Shirts")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await classifyProductCategories(params());

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.model).toBe("gpt-6.1-sol");
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(request.tools).toEqual([]);
    expect(request.tool_choice).toBeUndefined();
    expect(request.include).toBeUndefined();
    expect(request.instructions).toContain("Clothing > Shirts > Polo Shirts");
    expect(JSON.stringify(request.input)).toContain("Polo shirt blue");
    expect(JSON.stringify(request.input)).not.toContain("cdn.test/a.jpg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ categories: "Clothing > Shirts > Polo Shirts", categories__notFoundReason: "" });
  });

  it("charges the call's tokens only: cached and reasoning tokens priced, never a search fee", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(answer("Clothing")), { status: 200 })));
    const result = await classifyProductCategories(params());
    expect(result.costs).toHaveLength(1);
    const expected = calculateOpenAiWebSearchCost("gpt-6.1-sol", usage, 0);
    expect(result.costs[0].totalCost).toBeCloseTo(expected.totalCost, 12);
    expect(result.costs[0].webSearchCalls).toBe(0);
    expect(result.costs[0].searchCost).toBe(0);
    expect(result.costs[0].usage.cachedTokens).toBe(6_000);
  });

  it("an answer outside the store list is stored empty with an explanation, and the call is still charged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(answer("Electronics")), { status: 200 })));
    const result = await classifyProductCategories(params());
    expect(result.data.categories).toBe("");
    expect(String(result.data.categories__notFoundReason)).toContain("not in your store categories");
    expect(result.costs).toHaveLength(1);
  });

  it("a row with no usable data makes no call and costs nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await classifyProductCategories(params({ productData: { Photo: "https://cdn.test/a.jpg", Empty: "" } }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.costs).toEqual([]);
    expect(result.data.categories).toBe("");
  });

  it("suggest mode carries the format contract and no store list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(answer("Shirts > Polo Shirts > Blue")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const cols = [{ id: "categories", label: "Categories", description: "", type: "categories" as const, enabled: true, maxCategories: 1, categoryFormat: "depth2" as const }];
    const result = await classifyProductCategories(params({ workspaceCategories: [], enrichmentColumns: cols }));
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.instructions).toContain("at most 2 levels");
    expect(request.instructions).not.toContain("Allowed categories");
    expect(result.data.categories).toBe("Shirts > Polo Shirts");
  });

  it("turning the store list off suggests even though the store has categories", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(answer("Tops")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const cols = [{ id: "categories", label: "Categories", description: "", type: "categories" as const, enabled: true, useStoreCategories: false, categoryFormat: "flat" as const }];
    await classifyProductCategories(params({ enrichmentColumns: cols }));
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.instructions).not.toContain("Allowed categories");
    expect(request.instructions).toContain("flat categories");
  });
});

import { describe, expect, it } from "vitest";
import type { CategoryItem, EnrichmentColumn } from "@/types";
import { PLP_ENRICHMENT_COLUMNS } from "@/types";
import { buildEnrichedData } from "./parse";
import { buildEnrichJsonSchema } from "./schema";
import { buildEnrichPrompt } from "./prompt";
import { buildEnrichToolPolicy } from "./policy";
import { listColumnSpecs } from "./columns/registry";

const EMPTY_RESPONSE = { status: "completed", output: [] };

const CATEGORIES: CategoryItem[] = [
  { id: "1", name: "Running Shoes", slug: "running-shoes", fullPath: "Shoes > Running Shoes", parentId: "0" },
  { id: "2", name: "Trail Shoes", slug: "trail-shoes", fullPath: "Shoes > Trail Shoes", parentId: "0" },
  { id: "0", name: "Shoes", slug: "shoes", fullPath: "Shoes", parentId: null },
];

function cols(...ids: string[]): EnrichmentColumn[] {
  return PLP_ENRICHMENT_COLUMNS.filter((c) => ids.includes(c.id));
}

function parse(
  ids: string[],
  selection: Record<string, unknown>,
  extra: Parameters<typeof buildEnrichedData>[0] extends infer _ ? Record<string, unknown> : never = {}
) {
  return buildEnrichedData({
    selection,
    response: EMPTY_RESPONSE,
    enabledColumns: ids,
    enrichmentColumns: cols(...ids),
    kind: "plp",
    ...extra,
  });
}

describe("PLP column registry", () => {
  it("registers a spec for every default PLP column", () => {
    const specIds = new Set(listColumnSpecs("plp").map((s) => s.id));
    for (const col of PLP_ENRICHMENT_COLUMNS) {
      expect(specIds.has(col.id), `missing spec for ${col.id}`).toBe(true);
    }
  });

  it("names the schema per kind and requires every enabled column", () => {
    const ids = ["seoTitle", "metaDescription", "faq"];
    const policy = buildEnrichToolPolicy(ids, cols(...ids), "plp");
    const { name, schema } = buildEnrichJsonSchema(ids, cols(...ids), policy, {
      kind: "plp",
    });

    expect(name).toBe("import_plp_enrichment");
    expect(Object.keys(schema.properties as object).sort()).toEqual([
      "faq",
      "metaDescription",
      "notes",
      "seoTitle",
    ]);
  });

  it("never requests image search in PLP mode", () => {
    const ids = PLP_ENRICHMENT_COLUMNS.map((c) => c.id);
    const policy = buildEnrichToolPolicy(ids, PLP_ENRICHMENT_COLUMNS, "plp");
    expect(policy.needsImages).toBe(false);
    expect(policy.searchContentTypes).toEqual(["text"]);
    // Keyword / FAQ / SEO copy columns must force a search.
    expect(policy.toolChoice).toBe("required");
  });

  it("uses PLP framing and forbids price or stock claims", () => {
    const ids = ["seoTitle"];
    const policy = buildEnrichToolPolicy(ids, cols(...ids), "plp");
    const { text } = buildEnrichPrompt({
      productData: { name: "Running Shoes" },
      enabledColumns: ids,
      enrichmentColumns: cols(...ids),
      policy,
      kind: "plp",
    });

    expect(text).toContain("category page");
    expect(text).toContain("NEVER mention a specific price");
    expect(text).not.toContain("You enrich ONE ecommerce product");
  });

  it("clamps meta fields to their character budget", () => {
    const long = "Running shoes ".repeat(40);
    const data = parse(["seoTitle", "metaDescription", "h1"], {
      seoTitle: long,
      metaDescription: long,
      h1: long,
    });

    expect((data.seoTitle as string).length).toBeLessThanOrEqual(60);
    expect((data.metaDescription as string).length).toBeLessThanOrEqual(160);
    expect((data.h1 as string).length).toBeLessThanOrEqual(70);
  });

  it("reduces a target keyword list to one phrase", () => {
    expect(parse(["targetKeyword"], { targetKeyword: "running shoes, trail shoes" }).targetKeyword)
      .toBe("running shoes");
    expect(parse(["targetKeyword"], { targetKeyword: ["mens running shoes", "x"] }).targetKeyword)
      .toBe("mens running shoes");
  });

  it("drops FAQ pairs missing a question or answer, and dedupes", () => {
    const data = parse(["faq"], {
      faq: [
        { question: "How do I pick a size?", answer: "Measure your foot." },
        { question: "How do I pick a size?", answer: "Duplicate." },
        { question: "No answer?", answer: "" },
        { question: "", answer: "No question." },
      ],
    });
    expect(data.faq).toEqual([
      { question: "How do I pick a size?", answer: "Measure your foot." },
    ]);
  });

  it("keeps internal links inside the allowlist and excludes the page itself", () => {
    const data = parse(
      ["internalLinks"],
      { internalLinks: ["Shoes > Running Shoes", "Shoes > Trail Shoes", "Invented > Nope"] },
      { workspaceCategories: CATEGORIES, rowData: { name: "Running Shoes" } }
    );
    expect(data.internalLinks).toEqual(["Shoes > Trail Shoes"]);
  });

  it("rejects a parent category outside the allowlist or equal to itself", () => {
    const opts = { workspaceCategories: CATEGORIES, rowData: { name: "Running Shoes" } };
    expect(parse(["parentCategory"], { parentCategory: "Shoes" }, opts).parentCategory).toBe("Shoes");
    expect(parse(["parentCategory"], { parentCategory: "Invented" }, opts).parentCategory).toBe("");
    expect(parse(["parentCategory"], { parentCategory: "Running Shoes" }, opts).parentCategory).toBe("");
  });

  it("normalises the slug regardless of what the model returns", () => {
    expect(parse(["slug"], { slug: "Men's Running Shoes!" }).slug).toBe("mens-running-shoes");
    expect(parse(["slug"], { slug: "  Trail   Shoes  " }).slug).toBe("trail-shoes");
  });

  it("drops a secondary keyword that merely repeats the target", () => {
    const data = parse(
      ["secondaryKeywords"],
      { secondaryKeywords: ["running shoes", "mens running shoes", "running shoes"] },
      { rowData: { targetKeyword: "running shoes" } }
    );
    expect(data.secondaryKeywords).toEqual(["mens running shoes"]);
  });

  it("dedupes secondary keywords against the target the model just wrote", () => {
    // The uploaded row has no targetKeyword column; it comes from this answer.
    const data = parse(["targetKeyword", "secondaryKeywords"], {
      targetKeyword: "Running Shoes",
      secondaryKeywords: ["running shoes", "trail running shoes"],
    });
    expect(data.secondaryKeywords).toEqual(["trail running shoes"]);
  });

  it("stores nothing when the model returns an object for a text column", () => {
    expect(parse(["seoTitle"], { seoTitle: { bad: true } }).seoTitle).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  defaultSourceUrlsPlan,
  expandTries,
  placeholdersOf,
  readStoredPlan,
  renderPlanStep,
  SOURCE_URLS_PLAN_MAX_STEPS,
  validatePlanSteps,
  type SourceUrlsPlan,
} from "./plan";
import { buildPlannedQuery, SOURCE_URLS_FIXED_RULE } from "./skill";

const COLUMNS = ["Barcode", "Vendor SKU", "Description"];
const barcode = { name: "Barcode first", text: "Find the product page that sells the product with barcode {{Barcode}}." };
const sku = { name: "SKU", text: "Find the product page for vendor SKU {{Vendor SKU}}; a SKU that differs only in the last letter counts." };
const description = { name: "Description", text: "Search Google for: {{Description}} and give the exact product's page." };

const plan = (steps = [barcode, sku, description]): SourceUrlsPlan => ({
  version: 1,
  source: "planner",
  steps,
  columns: COLUMNS,
});

describe("placeholdersOf", () => {
  it("reads each column once, trimmed, in order", () => {
    expect(placeholdersOf("a {{Barcode}} b {{ Vendor   SKU }} c {{barcode}}")).toEqual(["Barcode", "Vendor SKU"]);
    expect(placeholdersOf("no columns here")).toEqual([]);
  });
});

describe("validatePlanSteps", () => {
  it("keeps real requests that use ticked columns", () => {
    const { steps, dropped } = validatePlanSteps([barcode, sku], COLUMNS);
    expect(steps).toEqual([barcode, sku]);
    expect(dropped).toEqual([]);
  });

  it("accepts column names in any letter case", () => {
    expect(validatePlanSteps([{ name: "x", text: "Find the page for the item with code {{vendor sku}}." }], COLUMNS).steps).toHaveLength(1);
  });

  it("drops a request that names a column the owner did not tick", () => {
    const result = validatePlanSteps([{ name: "x", text: "Find the page for the item with EAN {{EAN}} please." }], COLUMNS);
    expect(result.steps).toEqual([]);
    expect(result.dropped[0]).toMatch(/unknown column EAN/);
  });

  it("drops a request with no placeholder (it would ask the same thing for every row)", () => {
    const result = validatePlanSteps([{ name: "x", text: "Find every product page you can for this item." }], COLUMNS);
    expect(result.steps).toEqual([]);
    expect(result.dropped[0]).toMatch(/uses no column/);
  });

  it("drops empty, too short, too long and repeated requests, and non-objects", () => {
    const result = validatePlanSteps(
      [null, "text", { name: "a", text: "{{Barcode}}" }, { name: "b", text: `{{Barcode}} ${"x".repeat(1_600)}` }, barcode, { ...barcode, name: "again" }],
      COLUMNS
    );
    expect(result.steps).toEqual([barcode]);
    expect(result.dropped).toHaveLength(5);
  });

  it("keeps at most five steps and names an unnamed one", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: "", text: `Find the page for product number ${i} with barcode {{Barcode}}.` }));
    const { steps, dropped } = validatePlanSteps(many, COLUMNS);
    expect(steps).toHaveLength(SOURCE_URLS_PLAN_MAX_STEPS);
    expect(steps[0]!.name).toBe("Step 1");
    expect(dropped).toHaveLength(3);
  });

  it("treats anything that is not a list as no steps", () => {
    expect(validatePlanSteps(undefined, COLUMNS).steps).toEqual([]);
    expect(validatePlanSteps("nope", COLUMNS).steps).toEqual([]);
  });
});

describe("readStoredPlan", () => {
  it("reads back a good plan, billing included", () => {
    const stored = { ...plan(), model: "gpt-6.1-sol", notes: "n", billing: { credits: 0.1, cost: 0.01, tokens: 5, billedAttempts: 1, settled: true } };
    expect(readStoredPlan(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("reads the default plan", () => {
    expect(readStoredPlan(defaultSourceUrlsPlan("planner failed"))).toMatchObject({ source: "default", steps: [], reason: "planner failed" });
  });

  it("ignores anything malformed, so a bad saved value can only mean the default query", () => {
    expect(readStoredPlan(undefined)).toBeUndefined();
    expect(readStoredPlan("plan")).toBeUndefined();
    expect(readStoredPlan({ version: 2, source: "planner", steps: [barcode], columns: COLUMNS })).toBeUndefined();
    expect(readStoredPlan({ version: 1, source: "planner", steps: [], columns: COLUMNS })).toBeUndefined();
    expect(readStoredPlan({ version: 1, source: "planner", steps: [{ name: "x", text: "{{Nope}} find this page please" }], columns: COLUMNS })).toBeUndefined();
  });
});

describe("renderPlanStep", () => {
  const rowData = { Barcode: "5063229294815", "Vendor SKU": "S07FN6DB5", Description: "CHECK JACKET <b>BROWN</b> 6-9M", Photo: "[1 image attached]" };

  it("fills in the row's own values, matching names in any letter case", () => {
    expect(renderPlanStep(barcode, rowData)).toBe("Find the product page that sells the product with barcode 5063229294815.");
    expect(renderPlanStep({ name: "x", text: "Code {{vendor sku}} and {{DESCRIPTION}} here, please find it" }, rowData)).toBe(
      "Code S07FN6DB5 and CHECK JACKET BROWN 6-9M here, please find it"
    );
  });

  it("skips the step for a row where a needed column is empty or missing", () => {
    expect(renderPlanStep(barcode, { ...rowData, Barcode: "  " })).toBeNull();
    expect(renderPlanStep(barcode, { Description: "x" })).toBeNull();
    // An image placeholder is not a value.
    expect(renderPlanStep({ name: "x", text: "Find the page shown in {{Photo}} now, please" }, rowData)).toBeNull();
  });

  it("cuts a very long value", () => {
    const text = renderPlanStep(description, { Description: "d".repeat(2_000) })!;
    expect(text.length).toBeLessThan(500);
  });
});

describe("expandTries", () => {
  const rowData = { Barcode: "111", "Vendor SKU": "S1", Description: "Jacket" };

  it("tries the steps in the plan's order", () => {
    const tries = expandTries(plan(), rowData, 3);
    expect(tries.map((t) => t.label)).toEqual(["Barcode first", "SKU", "Description"]);
  });

  it("goes round again from the first step so all five searches are spent", () => {
    expect(expandTries(plan(), rowData, 5).map((t) => t.label)).toEqual(["Barcode first", "SKU", "Description", "Barcode first", "SKU"]);
    expect(expandTries(plan([barcode]), rowData, 5).map((t) => t.label)).toEqual(Array(5).fill("Barcode first"));
  });

  it("skips steps whose column is empty on this row, and uses the rest", () => {
    const tries = expandTries(plan(), { ...rowData, Barcode: "" }, 4);
    expect(tries.map((t) => t.label)).toEqual(["SKU", "Description", "SKU", "Description"]);
  });

  it("gives a row no step fits the default query (no label, no text), for every try", () => {
    const tries = expandTries(plan(), { Other: "x" }, 5);
    expect(tries).toHaveLength(5);
    expect(tries.every((t) => t.label === undefined && t.text === undefined)).toBe(true);
  });

  it("uses the default query for no plan and for a default plan", () => {
    expect(expandTries(undefined, rowData, 2)).toEqual([{}, {}]);
    expect(expandTries(defaultSourceUrlsPlan(), rowData, 2)).toEqual([{}, {}]);
  });

  it("never returns fewer than one try", () => {
    expect(expandTries(plan(), rowData, 0)).toHaveLength(1);
  });
});

describe("buildPlannedQuery", () => {
  it("is the filled-in step plus the fixed rule, and nothing else", () => {
    const query = buildPlannedQuery({ text: "Find the page for barcode 111." });
    expect(query).toBe(`Find the page for barcode 111.\n\n${SOURCE_URLS_FIXED_RULE}`);
    expect(query).not.toContain("Same product only");
    expect(query).not.toContain("photo");
  });

  it("asks for as many pages as can be found unless the request names a number", () => {
    expect(SOURCE_URLS_FIXED_RULE).toMatch(/as many product page links for this exact item as you can find/);
    expect(SOURCE_URLS_FIXED_RULE).toMatch(/unless the request above asks for a specific number of pages/);
    expect(buildPlannedQuery({ text: "Find it." })).toContain("as many product page links");
  });

  it("states the product-page rule and the answer format every time", () => {
    expect(SOURCE_URLS_FIXED_RULE).toMatch(/home page, category, collection, brand, search-results, blog or article page/);
    expect(SOURCE_URLS_FIXED_RULE).toContain('{"sources":[{"url":"https://...","title":"page title"}]}');
  });

  it("adds the photo line only when a photo is sent", () => {
    expect(buildPlannedQuery({ text: "Find it.", hasImage: true })).toContain("The attached photo shows the same product.");
    expect(buildPlannedQuery({ text: "Find it.", hasImage: false })).not.toContain("photo");
  });

  it("cuts the step, never the fixed rule, when the query would be too long", () => {
    const query = buildPlannedQuery({ text: "x".repeat(20_000), hasImage: true });
    expect(query.length).toBeLessThanOrEqual(8_000);
    expect(query.endsWith(SOURCE_URLS_FIXED_RULE)).toBe(true);
  });
});

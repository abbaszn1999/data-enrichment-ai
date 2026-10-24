import { describe, expect, it } from "vitest";
import {
  cutStepText,
  defaultSourceUrlsPlan,
  planRounds,
  placeholdersOf,
  readStoredPlan,
  renderIdentityLines,
  renderPlanStep,
  SOURCE_URLS_FIRST_ROUND_SEARCHES,
  SOURCE_URLS_IDENTITY_MAX_COLUMNS,
  SOURCE_URLS_IDENTITY_VALUE_CHARS,
  SOURCE_URLS_PLAN_MAX_STEPS,
  SOURCE_URLS_STEP_MAX_CHARS,
  validateIdentityColumns,
  validatePlanSteps,
  type SourceUrlsPlan,
} from "./plan";
import { buildPlannedQuery, buildSourceUrlsQuery, LIVE_LINKS_RULE, SOURCE_URLS_FIXED_RULE, SOURCE_URLS_IDENTITY_HEADING } from "./skill";

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

  it("keeps a request with no placeholder, a short one, and a repeated one: nothing is dropped for its quality", () => {
    const noColumn = { name: "Any", text: "Find every product page you can for this item." };
    const short = { name: "Short", text: "{{Barcode}}" };
    const result = validatePlanSteps([noColumn, short, noColumn], COLUMNS);
    expect(result.steps).toEqual([noColumn, short, noColumn]);
    expect(result.dropped).toEqual([]);
  });

  it("cuts a long request to the limit instead of dropping it", () => {
    const long = { name: "Long", text: `Find the page for barcode {{Barcode}}. ${"word ".repeat(400)}` };
    const { steps, dropped } = validatePlanSteps([long], COLUMNS);
    expect(dropped).toEqual([]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.text.length).toBeLessThanOrEqual(SOURCE_URLS_STEP_MAX_CHARS);
    expect(steps[0]!.text.startsWith("Find the page for barcode {{Barcode}}.")).toBe(true);
  });

  it("drops only what can never work: not a request, no text, or a column that is not ticked", () => {
    const result = validatePlanSteps([null, "text", { name: "a", text: "   " }, { name: "b" }, barcode], COLUMNS);
    expect(result.steps).toEqual([barcode]);
    expect(result.dropped).toHaveLength(4);
  });

  it("keeps the first three requests and names an unnamed one", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: "", text: `Find the page for product number ${i} with barcode {{Barcode}}.` }));
    const { steps, dropped } = validatePlanSteps(many, COLUMNS);
    expect(SOURCE_URLS_PLAN_MAX_STEPS).toBe(3);
    expect(steps).toHaveLength(3);
    expect(steps[0]!.name).toBe("Step 1");
    expect(dropped).toHaveLength(5);
  });
  it("treats anything that is not a list as no steps", () => {
    expect(validatePlanSteps(undefined, COLUMNS).steps).toEqual([]);
    expect(validatePlanSteps("nope", COLUMNS).steps).toEqual([]);
  });
});

describe("cutStepText", () => {
  it("leaves a request within the limit untouched", () => {
    expect(cutStepText("Find the page for {{Barcode}}.")).toBe("Find the page for {{Barcode}}.");
  });

  it("cuts at a word break and never through the middle of a placeholder", () => {
    const text = `${"a".repeat(590)} {{Vendor SKU}} tail`;
    const cut = cutStepText(text);
    expect(cut.length).toBeLessThanOrEqual(SOURCE_URLS_STEP_MAX_CHARS);
    expect(cut).not.toContain("{{");
    expect(cutStepText("word ".repeat(300), 100).length).toBeLessThanOrEqual(100);
    expect(cutStepText("word ".repeat(300), 100).endsWith("word")).toBe(true);
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

describe("planRounds", () => {
  const rowData = { Barcode: "111", "Vendor SKU": "S1", Description: "Jacket" };
  const labels = (tries: Array<{ label?: string }>) => tries.map((t) => t.label);

  it("asks the strongest request three times at once, then the other two together", () => {
    const { first, second } = planRounds(plan(), rowData, 5);
    expect(labels(first)).toEqual(["Barcode first", "Barcode first", "Barcode first"]);
    expect(labels(second)).toEqual(["SKU", "Description"]);
    expect(SOURCE_URLS_FIRST_ROUND_SEARCHES).toBe(3);
  });

  it("repeats the last other request when only two requests are usable", () => {
    const { first, second } = planRounds(plan([barcode, sku]), rowData, 5);
    expect(labels(first)).toEqual(Array(3).fill("Barcode first"));
    expect(labels(second)).toEqual(["SKU", "SKU"]);
  });

  it("repeats the only request when one is usable, so all five searches are still spent", () => {
    const { first, second } = planRounds(plan([barcode]), rowData, 5);
    expect(labels(first)).toEqual(Array(3).fill("Barcode first"));
    expect(labels(second)).toEqual(Array(2).fill("Barcode first"));
  });

  it("skips a request whose column is empty on this row, and uses the rest in the plan's order", () => {
    const { first, second } = planRounds(plan(), { ...rowData, Barcode: "" }, 5);
    expect(labels(first)).toEqual(Array(3).fill("SKU"));
    expect(labels(second)).toEqual(["Description", "Description"]);
  });

  it("gives a row no request fits the default query (no label, no text) in both rounds", () => {
    const { first, second } = planRounds(plan(), { Other: "x" }, 5);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(2);
    expect([...first, ...second].every((t) => t.label === undefined && t.text === undefined)).toBe(true);
  });

  it("uses the default query for no plan and for a default plan", () => {
    expect(planRounds(undefined, rowData, 5)).toEqual({ first: [{}, {}, {}], second: [{}, {}] });
    expect(planRounds(defaultSourceUrlsPlan(), rowData, 5)).toEqual({ first: [{}, {}, {}], second: [{}, {}] });
  });

  it("honours a lower total and never returns fewer than one search", () => {
    const two = planRounds(plan(), rowData, 2);
    expect(two.first).toHaveLength(2);
    expect(two.second).toHaveLength(0);
    const four = planRounds(plan(), rowData, 4);
    expect(four.first).toHaveLength(3);
    expect(labels(four.second)).toEqual(["SKU"]);
    expect(planRounds(plan(), rowData, 0).first).toHaveLength(1);
  });
});
describe("identity columns", () => {
  const rowData = { Barcode: "3700802102649", "Vendor SKU": "TA001", Title: "75 Wash-Off Tattoos - Assortment", Brand: "Buki", Qty: "6", Photo: "[1 image attached]" };
  const withIdentity = (identityColumns?: string[]): SourceUrlsPlan => ({
    ...plan(),
    columns: ["Barcode", "Vendor SKU", "Description", "Title", "Brand", "Qty"],
    ...(identityColumns ? { identityColumns } : {}),
  });

  it("keeps only ticked columns, once each, in the ticked spelling, at most six", () => {
    const names = ["Barcode", "Vendor SKU", "Title", "Brand", "Qty", "A", "B", "C"];
    expect(validateIdentityColumns(["brand", "TITLE", "title", "Nope", 3, null], names)).toEqual(["Brand", "Title"]);
    expect(validateIdentityColumns(names, names)).toHaveLength(SOURCE_URLS_IDENTITY_MAX_COLUMNS);
    expect(validateIdentityColumns(undefined, names)).toEqual([]);
    expect(validateIdentityColumns("Brand", names)).toEqual([]);
  });

  it("writes one 'Name: value' line per identity column, with this row's values", () => {
    expect(renderIdentityLines(withIdentity(["Brand", "Title"]), rowData)).toEqual([
      "Brand: Buki",
      "Title: 75 Wash-Off Tattoos - Assortment",
    ]);
  });

  it("leaves a column with no value on this row out, without skipping anything", () => {
    expect(renderIdentityLines(withIdentity(["Brand", "Title"]), { ...rowData, Brand: " " })).toEqual([
      "Title: 75 Wash-Off Tattoos - Assortment",
    ]);
    expect(renderIdentityLines(withIdentity(["Brand"]), { Title: "x" })).toEqual([]);
  });

  it("uses every ticked column with a value when the planner chose none, never an image", () => {
    const lines = renderIdentityLines(withIdentity(), rowData);
    expect(lines).toContain("Barcode: 3700802102649");
    expect(lines).toContain("Qty: 6");
    expect(lines.some((line) => line.startsWith("Photo"))).toBe(false);
  });

  it("cuts a long value", () => {
    const [line] = renderIdentityLines(withIdentity(["Title"]), { Title: "t".repeat(2_000) });
    expect(line!.length).toBe("Title: ".length + SOURCE_URLS_IDENTITY_VALUE_CHARS);
  });

  it("goes with every try of a row, whichever step it is, and is saved with the plan", () => {
    const { first, second } = planRounds(withIdentity(["Brand", "Title"]), rowData, 5);
    const tries = [...first, ...second];
    // The row has no Description, so that request is skipped: the barcode three times, then the SKU twice.
    expect(tries.map((t) => t.label)).toEqual(["Barcode first", "Barcode first", "Barcode first", "SKU", "SKU"]);
    for (const t of tries) expect(t.identity).toEqual(["Brand: Buki", "Title: 75 Wash-Off Tattoos - Assortment"]);
    const stored = { ...withIdentity(["Brand", "Title"]), model: "gpt-6.1-sol" };
    expect(readStoredPlan(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("drops stored identity columns that are not ticked columns, and keeps a plan without any", () => {
    expect(readStoredPlan({ ...withIdentity(["Brand", "Hacked"]) })!.identityColumns).toEqual(["Brand"]);
    expect(readStoredPlan(withIdentity())!.identityColumns).toBeUndefined();
  });

  it("is not added to the default query", () => {
    expect(planRounds(undefined, rowData, 1)).toEqual({ first: [{}], second: [] });
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

  it("puts the identity between the step and the fixed rule, as a list to confirm the page, not to search by", () => {
    const query = buildPlannedQuery({
      text: "Find the page for supplier code TA001.",
      hasImage: true,
      identity: ["Brand: Buki", "Title: 75 Wash-Off Tattoos - Assortment"],
    });
    expect(query).toBe(
      `Find the page for supplier code TA001.\n\n${SOURCE_URLS_IDENTITY_HEADING}\n- Brand: Buki\n- Title: 75 Wash-Off Tattoos - Assortment\n\nThe attached photo shows the same product.\n\n${SOURCE_URLS_FIXED_RULE}`
    );
    expect(SOURCE_URLS_IDENTITY_HEADING).toMatch(/only to confirm.*do not search by these/);
  });

  it("adds no identity block when there is no identity line", () => {
    expect(buildPlannedQuery({ text: "Find it.", identity: [] })).toBe(`Find it.\n\n${SOURCE_URLS_FIXED_RULE}`);
    expect(buildPlannedQuery({ text: "Find it." })).not.toContain(SOURCE_URLS_IDENTITY_HEADING);
  });

  it("drops identity lines from the end, then cuts the step, and never cuts the fixed rule", () => {
    const lines = Array.from({ length: 6 }, (_, i) => `Column ${i}: ${"v".repeat(200)}`);
    const crowded = buildPlannedQuery({ text: "s".repeat(7_000), identity: lines });
    expect(crowded.length).toBeLessThanOrEqual(8_000);
    expect(crowded.endsWith(SOURCE_URLS_FIXED_RULE)).toBe(true);
    expect(crowded).not.toContain("Column 5");
    const absurd = buildPlannedQuery({ text: "s".repeat(20_000), identity: lines });
    expect(absurd.length).toBeLessThanOrEqual(8_000);
    expect(absurd).not.toContain(SOURCE_URLS_IDENTITY_HEADING);
    expect(absurd.endsWith(SOURCE_URLS_FIXED_RULE)).toBe(true);
  });

  it("tells Google, in every planned search and in the default one, to return only live links it really found", () => {
    expect(LIVE_LINKS_RULE).toMatch(/found in your sources and that are live today/);
    expect(LIVE_LINKS_RULE).toMatch(/Never guess, shorten or build a link/);
    expect(LIVE_LINKS_RULE).toMatch(/redirects to a home page, a category page or an error page/);
    expect(SOURCE_URLS_FIXED_RULE).toContain(LIVE_LINKS_RULE);
    expect(buildSourceUrlsQuery({ rowData: { Title: "x" } })).toContain(LIVE_LINKS_RULE);
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

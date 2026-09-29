import { describe, expect, it } from "vitest";
import { buildExactLinksQuery, parseExactLinksResult } from "./links-skill";

describe("buildExactLinksQuery", () => {
  it("includes only the fields the row actually has, in sheet order", () => {
    const query = buildExactLinksQuery({
      rowData: { Brand: "Haier", Code: "HRF-570WH", Description: "NO FROST TOP MOUNT REFRIGERATOR" },
      rowIdentifiers: ["HRF-570WH"],
    });
    expect(query).toContain("- Brand: Haier");
    expect(query).toContain("- Code: HRF-570WH");
    expect(query).toContain("- Description: NO FROST TOP MOUNT REFRIGERATOR");
    expect(query).toContain("Code-like values in this row");
    expect(query).toContain("HRF-570WH");
  });

  it("drops empty and image-URL fields", () => {
    const query = buildExactLinksQuery({
      rowData: { Brand: "Haier", Empty: "", Photo: "https://cdn.test/a.jpg" },
      rowIdentifiers: [],
    });
    expect(query).toContain("- Brand: Haier");
    expect(query).not.toContain("Empty");
    expect(query).not.toContain("Photo");
    expect(query).not.toContain("cdn.test/a.jpg");
  });

  it("says so when the row has no usable data", () => {
    const query = buildExactLinksQuery({ rowData: {}, rowIdentifiers: [] });
    expect(query).toContain("No usable product data was provided.");
  });

  it("lays out the six steps in order", () => {
    const query = buildExactLinksQuery({ rowData: { Brand: "Adidas" }, rowIdentifiers: [] });
    const headers = [
      "STEP 1 — READ THE ROW AS A WHOLE",
      "STEP 2 — DECIDE THE IDENTITY PATH",
      "STEP 3 — STORE OWNER INSTRUCTION",
      "STEP 4 — SEARCH BROADLY, VERIFY NARROWLY",
      "STEP 5 — CONFIRM EACH CANDIDATE",
      "STEP 6 — RETURN LINKS ONLY, BEST FIRST, UP TO 10",
    ].map((h) => query.indexOf(h));
    expect(headers.every((i) => i >= 0)).toBe(true);
    expect([...headers].sort((a, b) => a - b)).toEqual(headers);
  });

  it("asks for up to 10 links, never 3", () => {
    const query = buildExactLinksQuery({ rowData: { Brand: "Adidas" }, rowIdentifiers: [] });
    expect(query).toContain("Return up to 10 full https:// product-page URLs");
    expect(query).toContain("Maximum 10 matches");
    expect(query).not.toContain("up to 3");
  });

  it("covers both the code path and the no-code path in Step 2", () => {
    const query = buildExactLinksQuery({ rowData: { Brand: "Adidas" }, rowIdentifiers: [] });
    expect(query).toContain("the code is the ONLY proof of identity");
    expect(query).toContain("The row has no code");
    expect(query).toContain("two different products fit about equally well");
  });

  it("puts the custom instruction in Step 3, marked as overriding the defaults", () => {
    const query = buildExactLinksQuery({
      rowData: { Brand: "Adidas" },
      rowIdentifiers: [],
      customInstruction: "Only use adidas.com or eBay.",
    });
    const step3 = query.indexOf("STEP 3 — STORE OWNER INSTRUCTION");
    const text = query.indexOf("Only use adidas.com or eBay.");
    expect(text).toBeGreaterThan(step3);
    expect(text).toBeLessThan(query.indexOf("STEP 4"));
    expect(query).toContain("overrides the defaults");
  });

  it("says None given. in Step 3 when there is no custom instruction", () => {
    const query = buildExactLinksQuery({ rowData: { Brand: "Adidas" }, rowIdentifiers: [] });
    expect(query).toContain("STEP 3 — STORE OWNER INSTRUCTION\nNone given.");
  });

  it("keeps the steps and output format intact when the row is huge", () => {
    const rowData: Record<string, string> = {};
    for (let i = 0; i < 20; i++) rowData[`Field${i}`] = "x".repeat(300);
    const query = buildExactLinksQuery({
      rowData,
      rowIdentifiers: ["ABC123"],
      customInstruction: "y".repeat(5_000),
    });
    expect(query.length).toBeLessThanOrEqual(8_000);
    expect(query).toContain("STEP 6 — RETURN LINKS ONLY");
    expect(query).toContain("Maximum 10 matches");
    expect(query.trimEnd().endsWith("matches is an empty array.")).toBe(true);
    expect(query).toContain("- Field0:");
  });

  it("asks for JSON-only output with the exact fields the parser expects", () => {
    const query = buildExactLinksQuery({ rowData: { Brand: "Adidas" }, rowIdentifiers: [] });
    expect(query).toContain('"result":"MATCHES_FOUND"');
    expect(query).toContain('"matches"');
  });
});

describe("parseExactLinksResult", () => {
  it("parses a clean MATCHES_FOUND answer", () => {
    const text =
      '{"result":"MATCHES_FOUND","matches":[{"url":"https://shop.test/p/1","site":"Shop","matchedOn":"code","evidence":"SKU: X","differences":"none"}]}';
    expect(parseExactLinksResult(text)).toEqual({
      result: "MATCHES_FOUND",
      matches: [
        {
          url: "https://shop.test/p/1",
          site: "Shop",
          matchedOn: "code",
          evidence: "SKU: X",
          differences: "none",
        },
      ],
    });
  });

  it("accepts snake_case matched_on as a fallback", () => {
    const text = '{"result":"MATCHES_FOUND","matches":[{"url":"https://shop.test/p/1","matched_on":"code"}]}';
    expect(parseExactLinksResult(text).matches[0].matchedOn).toBe("code");
  });

  it("treats NO_EXACT_MATCH as an empty result even with stray matches", () => {
    const text = '{"result":"NO_EXACT_MATCH","matches":[]}';
    expect(parseExactLinksResult(text)).toEqual({ result: "NO_EXACT_MATCH", matches: [] });
  });

  it("drops candidates with no url", () => {
    const text = '{"result":"MATCHES_FOUND","matches":[{"site":"Shop"},{"url":"https://shop.test/p/1"}]}';
    expect(parseExactLinksResult(text).matches).toHaveLength(1);
  });

  it("treats unparseable text as NO_EXACT_MATCH rather than throwing", () => {
    expect(parseExactLinksResult("STATUS: NOT_FOUND")).toEqual({ result: "NO_EXACT_MATCH", matches: [] });
  });

  it("treats empty text as NO_EXACT_MATCH", () => {
    expect(parseExactLinksResult("")).toEqual({ result: "NO_EXACT_MATCH", matches: [] });
  });
});

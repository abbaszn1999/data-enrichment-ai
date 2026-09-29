import { describe, expect, it } from "vitest";
import { buildExactLinksQuery, parseExactLinksAnswer, parseExactLinksResult } from "./links-skill";

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
      "STEP 4 — SEARCH (build your own queries from what this row contains)",
      "STEP 5 — CONFIRM EACH LINK",
      "STEP 6 — RETURN LINKS ONLY, BEST FIRST, UP TO 10",
    ].map((h) => query.indexOf(h));
    expect(headers.every((i) => i >= 0)).toBe(true);
    expect([...headers].sort((a, b) => a - b)).toEqual(headers);
  });

  it("opens with the search task naming the row's identifiers, before any step", () => {
    const query = buildExactLinksQuery({
      rowData: { Brand: "Haier", Code: "HRF-570WH" },
      rowIdentifiers: ["HRF-570WH"],
    });
    expect(query.startsWith("TASK\nFind product pages for this exact item, identified by: HRF-570WH")).toBe(true);
    expect(query.indexOf("TASK")).toBeLessThan(query.indexOf("STEP 1"));
  });

  it("describes the item by its row when there is no identifier", () => {
    const query = buildExactLinksQuery({ rowData: { Brand: "Adidas" }, rowIdentifiers: [] });
    expect(query).toContain("Find product pages for the exact item described below.");
  });

  it("builds Step 4 searches from the row, with no catalog-specific query hard-coded", () => {
    const query = buildExactLinksQuery({
      rowData: { Code: "ZX-9" },
      rowIdentifiers: ["ZX-9"],
    });
    const step4 = query.slice(query.indexOf("STEP 4"), query.indexOf("STEP 5"));
    expect(step4).toContain("build your own queries from what this row contains");
    expect(step4).toContain("The strongest identifier alone, in quotes.");
    expect(step4).not.toContain("ZX-9");
    expect(step4).not.toMatch(/\bbuy\b/i);
  });

  it("avoids phrases that made Google AI Mode hang or answer with web results (live-tested)", () => {
    for (const attempt of [1, 2] as const) {
      const query = buildExactLinksQuery({ rowData: { Code: "ZX-9" }, rowIdentifiers: ["ZX-9"], attempt });
      const task = query.slice(0, query.indexOf("PRODUCT"));
      // "Search thoroughly …" made the call time out; "found nothing" was searched as a web query.
      expect(query).not.toMatch(/search thoroughly/i);
      expect(task).not.toMatch(/found nothing|returns nothing|no usable/i);
      expect(query).not.toMatch(/returns nothing/i);
    }
  });

  it("does not demand verbatim page text as evidence", () => {
    const query = buildExactLinksQuery({ rowData: { Brand: "Adidas" }, rowIdentifiers: [] });
    expect(query).not.toContain("verbatim");
    expect(query).not.toContain("returning no link is the correct answer");
  });

  it("attempt 2 asks for different angles and keeps the same steps and output format", () => {
    const first = buildExactLinksQuery({ rowData: { Code: "ZX-9" }, rowIdentifiers: ["ZX-9"] });
    const second = buildExactLinksQuery({ rowData: { Code: "ZX-9" }, rowIdentifiers: ["ZX-9"], attempt: 2 });
    expect(second).not.toBe(first);
    expect(second).toContain("Find product pages for this exact item, identified by: ZX-9");
    expect(second).toContain("Use search angles beyond the obvious ones.");
    expect(second).toContain("STEP 4 — SEARCH (new angles only");
    expect(second).toContain("manufacturer's or brand's own website");
    for (const header of ["STEP 1", "STEP 2", "STEP 3", "STEP 5", "STEP 6"]) {
      expect(second).toContain(header);
    }
    expect(second).toContain('"result":"MATCHES_FOUND"');
    expect(second).toContain("Maximum 10 matches");
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

  it("parseExactLinksAnswer tells an unreadable answer from an empty one", () => {
    expect(parseExactLinksAnswer("no json here").readable).toBe(false);
    expect(parseExactLinksAnswer("").readable).toBe(false);
    expect(parseExactLinksAnswer('{"result":"NO_EXACT_MATCH","matches":[]}')).toEqual({
      result: "NO_EXACT_MATCH",
      matches: [],
      readable: true,
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCHAPI_COST_PER_SEARCH, costToCredits } from "@/lib/ai-pricing";
import { SearchApiCallError } from "../image-finder/exact/searchapi";
import { EnrichBilledAttemptError, EnrichCancelledError } from "../openai";

const callLensMock = vi.hoisted(() => vi.fn());

vi.mock("./searchapi-lens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./searchapi-lens")>()),
  callGoogleLens: callLensMock,
}));

const { findLensMatches, searchLensMatches } = await import("./agent");
const { parseLensMatches } = await import("./searchapi-lens");
const { detectLensImageColumn, lensImageForRow, lensImagesFromCell } = await import("./image-column");
const { isLensRun, lensRunConflict } = await import("./run");
const { normalizeFinderOutputs } = await import("@/types");

const IMAGE = "https://cdn.test/p.jpg";
const NO_RULES = { allowedDomains: [], blockedDomains: [] };
const match = (link: string, title = "") => ({ link, title });
const answer = (
  searchType: "exact_matches" | "visual_matches" | "products",
  matches: Array<{ link: string; title: string; price?: string }>
) => ({
  matches,
  searchType,
  httpStatus: 200,
  elapsedMs: 5,
});
const search = (overrides: Record<string, unknown> = {}) =>
  searchLensMatches({ imageUrl: IMAGE, scope: "exact", limit: 10, rules: NO_RULES, retryDelayMs: 0, ...overrides });

describe("parseLensMatches", () => {
  it("keeps http(s) pages with their titles and drops redirects and junk", () => {
    expect(
      parseLensMatches([
        { link: "https://shop.test/p/1", title: " Widget ", source: "Shop" },
        { link: "https://www.google.com/goto?url=ABC", title: "Unresolved" },
        { link: "ftp://x.test/a", title: "ftp" },
        { link: "", title: "empty" },
        { title: "no link" },
      ])
    ).toEqual([{ link: "https://shop.test/p/1", title: "Widget", source: "Shop" }]);
    expect(parseLensMatches(undefined)).toEqual([]);
  });
});

describe("searchLensMatches billing", () => {
  beforeEach(() => callLensMock.mockReset());

  it("bills exactly one search for a row that finds pages", async () => {
    callLensMock.mockResolvedValueOnce(answer("exact_matches", [match("https://a.test/p/1", "A")]));
    const result = await search();
    expect(result.sources).toHaveLength(1);
    expect(result.costs).toHaveLength(1);
    expect(result.costs[0]).toMatchObject({ model: "searchapi-google-lens", searchApiCalls: 1 });
    expect(result.costs[0]!.totalCost).toBeCloseTo(SEARCHAPI_COST_PER_SEARCH, 10);
    expect(costToCredits(result.costs[0]!.totalCost)).toBe(0.04);
    expect(callLensMock).toHaveBeenCalledWith(IMAGE, "exact_matches");
  });

  it("still bills a search that found nothing, and says why", async () => {
    callLensMock.mockResolvedValueOnce(answer("exact_matches", []));
    const result = await search();
    expect(result.sources).toEqual([]);
    expect(result.costs).toHaveLength(1);
    expect(result.notFoundReason).toMatch(/found no page/);
  });

  it("says when every page was on a blocked website", async () => {
    callLensMock.mockResolvedValueOnce(answer("exact_matches", [match("https://pin.test/p/1", "Pin")]));
    const result = await search({ rules: { allowedDomains: [], blockedDomains: ["pin.test"] } });
    expect(result.sources).toEqual([]);
    expect(result.notFoundReason).toMatch(/none is a product page you allow: 1 blocked by your website rules/);
  });

  it("says what was set aside when every page was not a product page", async () => {
    callLensMock.mockResolvedValueOnce(
      answer("exact_matches", [
        match("https://www.youtube.com/watch?v=1", "Video"),
        match("https://shop.test/reviews/toys", "Toys"),
        match("https://shop.test/", "Home"),
      ])
    );
    const result = await search();
    expect(result.sources).toEqual([]);
    expect(result.setAside.map((page) => page.reason)).toEqual(["site", "listing", "not_page"]);
    expect(result.notFoundReason).toMatch(/found 3 page\(s\), but none is a product page you allow/);
    expect(result.notFoundReason).toMatch(/1 on video, social, reference or stock-photo sites/);
    expect(result.notFoundReason).toMatch(/1 category, review or article page\(s\)/);
    expect(result.notFoundReason).toMatch(/1 home page\(s\) or file\(s\)/);
  });

  it("keeps everything Google listed when product pages only is off", async () => {
    callLensMock.mockResolvedValueOnce(answer("exact_matches", [match("https://shop.test/collections/toys", "Toys")]));
    const result = await search({ productsOnly: false });
    expect(result.sources.map((s) => s.uri)).toEqual(["https://shop.test/collections/toys"]);
  });

  it("runs one products search for the Products option and bills it once", async () => {
    callLensMock.mockResolvedValueOnce(
      answer("products", [{ ...match("https://www.walmart.com/ip/toy/123", "Toy"), price: "$20*" }])
    );
    const result = await search({ scope: "products" });
    expect(callLensMock).toHaveBeenCalledTimes(1);
    expect(callLensMock).toHaveBeenCalledWith(IMAGE, "products");
    expect(result.sources.map((s) => s.uri)).toEqual(["https://www.walmart.com/ip/toy/123"]);
    expect(result.costs).toHaveLength(1);
  });

  it("makes no call and bills nothing for a row without a picture", async () => {
    const result = await search({ imageUrl: undefined });
    expect(callLensMock).not.toHaveBeenCalled();
    expect(result.costs).toEqual([]);
    expect(result.notFoundReason).toMatch(/no picture/);
  });

  it("does not bill a failed search and retries a rate limit once without charging it", async () => {
    callLensMock
      .mockRejectedValueOnce(new SearchApiCallError("rate limited", false, 429))
      .mockResolvedValueOnce(answer("exact_matches", [match("https://a.test/p/1", "A")]));
    const result = await search();
    expect(callLensMock).toHaveBeenCalledTimes(2);
    expect(result.costs).toHaveLength(1);
  });

  it("throws a failure with nothing billed as-is", async () => {
    callLensMock.mockRejectedValueOnce(new SearchApiCallError("bad key", false, 401));
    const error = await search().catch((e) => e);
    expect(error).toBeInstanceOf(SearchApiCallError);
    expect(error).not.toBeInstanceOf(EnrichBilledAttemptError);
  });

  it("charges a billed failure", async () => {
    callLensMock.mockRejectedValueOnce(new SearchApiCallError("answered then broke", true));
    const error = await search().catch((e) => e);
    expect(error).toBeInstanceOf(EnrichBilledAttemptError);
    expect((error as EnrichBilledAttemptError).costs).toHaveLength(1);
  });

  it("asks for similar matches only when the exact ones fall short, and bills each search", async () => {
    callLensMock
      .mockResolvedValueOnce(answer("exact_matches", [match("https://a.test/p/1", "A")]))
      .mockResolvedValueOnce(answer("visual_matches", [match("https://b.test/p/2", "B"), match("https://a.test/p/1", "A")]));
    const result = await search({ scope: "exact_and_visual", limit: 5 });
    expect(callLensMock.mock.calls.map((c) => c[1])).toEqual(["exact_matches", "visual_matches"]);
    expect(result.sources.map((s) => s.uri)).toEqual(["https://a.test/p/1", "https://b.test/p/2"]);
    expect(result.costs).toHaveLength(2);
    expect(result.searches).toBe(2);
  });

  it("skips the second search when the exact pages already fill the limit", async () => {
    callLensMock.mockResolvedValueOnce(
      answer("exact_matches", [match("https://a.test/p/1", "A"), match("https://b.test/p/2", "B")])
    );
    const result = await search({ scope: "exact_and_visual", limit: 2 });
    expect(callLensMock).toHaveBeenCalledTimes(1);
    expect(result.costs).toHaveLength(1);
  });

  it("keeps the exact pages and both charges when the similar search fails", async () => {
    callLensMock
      .mockResolvedValueOnce(answer("exact_matches", [match("https://a.test/p/1", "A")]))
      .mockRejectedValueOnce(new SearchApiCallError("boom", false, 500))
      .mockRejectedValueOnce(new SearchApiCallError("boom again", false, 500));
    const result = await search({ scope: "exact_and_visual", limit: 5 });
    expect(result.sources).toHaveLength(1);
    expect(result.costs).toHaveLength(1);
  });

  it("stops before the second search when the owner pressed Stop, keeping the first charge", async () => {
    callLensMock.mockResolvedValueOnce(answer("exact_matches", []));
    const error = await search({ scope: "exact_and_visual", shouldCancel: async () => true }).catch((e) => e);
    expect(error).toBeInstanceOf(EnrichCancelledError);
    expect((error as EnrichCancelledError).costs).toHaveLength(1);
    expect(callLensMock).toHaveBeenCalledTimes(1);
  });
});

describe("findLensMatches", () => {
  beforeEach(() => callLensMock.mockReset());

  it("writes the pages to Lens founds, clears the not-found note, and reads the column settings", async () => {
    callLensMock.mockResolvedValueOnce(
      answer("exact_matches", [match("https://a.test/p/1", "A"), match("https://b.test/p/2", "B"), match("https://c.test/p/3", "C")])
    );
    const result = await findLensMatches({
      productData: {},
      enabledColumns: ["lensFounds"],
      sourceImageUrls: [IMAGE],
      enrichmentColumns: [
        { id: "lensFounds", label: "Lens founds", description: "", type: "sourceUrls", enabled: true, sourceCount: 2, blockedDomains: ["b.test"] },
      ],
    });
    expect(result.data.lensFounds).toEqual([
      { title: "A", uri: "https://a.test/p/1", note: "Product page" },
      { title: "C", uri: "https://c.test/p/3", note: "Product page" },
    ]);
    expect(result.data["lensFounds__notFoundReason"]).toBe("");
    expect(result.data["lensFounds__alsoFound"]).toEqual([]);
    expect(result.data["lensFounds__setAside"]).toEqual([]);
    expect(result.costs).toHaveLength(1);
  });

  it("keeps two pages per website, puts the rest under also found, and lists what was set aside", async () => {
    callLensMock.mockResolvedValueOnce(
      answer("exact_matches", [
        match("https://www.ebay.co.uk/sch/i.html?_nkw=gun", "Toy Guns - eBay UK"),
        match("https://www.ebay.co.uk/itm/1", "Gun one - eBay UK"),
        match("https://www.ebay.co.uk/itm/2", "Gun two - eBay UK"),
        match("https://www.ebay.com/itm/3", "Gun three - eBay"),
        match("https://shop.test/products/gun", "Gun - Shop"),
      ])
    );
    const result = await findLensMatches({
      productData: { DESC: "Spiderman Toy Gun M416" },
      enabledColumns: ["lensFounds"],
      sourceImageUrls: [IMAGE],
      enrichmentColumns: [
        { id: "lensFounds", label: "Lens founds", description: "", type: "sourceUrls", enabled: true, sourceCount: 10 },
      ],
    });
    const kept = result.data.lensFounds as Array<{ uri: string }>;
    expect(kept.map((page) => page.uri).sort()).toEqual(
      ["https://shop.test/products/gun", "https://www.ebay.co.uk/itm/1", "https://www.ebay.co.uk/itm/2"].sort()
    );
    expect(result.data["lensFounds__alsoFound"]).toEqual([
      expect.objectContaining({ uri: "https://www.ebay.com/itm/3" }),
    ]);
    expect(result.data["lensFounds__setAside"]).toEqual([
      { uri: "https://www.ebay.co.uk/sch/i.html?_nkw=gun", reason: "listing" },
    ]);
  });
});

describe("Lens run helpers", () => {
  it("recognises a lens-only run and rejects mixing it with the other finder outputs", () => {
    expect(isLensRun("product", ["lensFounds"])).toBe(true);
    expect(isLensRun("product", ["lensFounds", "sourceUrls"])).toBe(false);
    expect(isLensRun("plp", ["lensFounds"])).toBe(false);
    expect(lensRunConflict(["lensFounds"])).toBeNull();
    expect(lensRunConflict(["imageUrls", "imageSourceUrls"])).toBeNull();
    expect(lensRunConflict(["lensFounds", "imageUrls"])).toMatch(/Images or Source URLs/);
    expect(lensRunConflict(["lensFounds", "sourceUrls"])).toMatch(/Images or Source URLs/);
    expect(lensRunConflict(["lensFounds", "titleTag"])).toMatch(/on its own/);
  });

  it("keeps exactly one finder output", () => {
    expect(normalizeFinderOutputs(["lens"])).toEqual(["lens"]);
    expect(normalizeFinderOutputs(["sourceUrls", "images"])).toEqual(["images"]);
    expect(normalizeFinderOutputs(["sourceUrls", "lens"])).toEqual(["sourceUrls"]);
    expect(normalizeFinderOutputs(["images", "lens"])).toEqual(["images"]);
    expect(normalizeFinderOutputs([])).toEqual([]);
    expect(normalizeFinderOutputs(["junk"])).toEqual(["images"]);
    expect(normalizeFinderOutputs(undefined)).toEqual(["images"]);
  });
});

describe("Lens picture column", () => {
  const row = (originalData: Record<string, unknown>, enrichedData: Record<string, unknown> = {}) => ({ originalData, enrichedData });

  it("takes the first picture of a cell: a saved sheet picture first, else any link", () => {
    expect(lensImagesFromCell("vz-storage:w/a.png\nvz-storage:w/b.png")).toEqual(["vz-storage:w/a.png", "vz-storage:w/b.png"]);
    expect(lensImagesFromCell("https://cdn.test/img?id=1, https://cdn.test/img?id=2")).toHaveLength(2);
    expect(lensImagesFromCell("")).toEqual([]);
    expect(lensImageForRow(row({ Pic: "vz-storage:w/a.png" }), "Pic")).toBe("vz-storage:w/a.png");
    expect(lensImageForRow(row({ Pic: "" }), "Pic")).toBeNull();
    expect(lensImageForRow(row({}, { imageUrls: [{ imageUrl: "https://cdn.test/x.jpg" }] }), "imageUrls")).toBe("https://cdn.test/x.jpg");
  });

  it("finds the first column that holds pictures, else Image URLs from Image Finder, else nothing", () => {
    const rows = [
      row({ Name: "A", Picture: "vz-storage:w/a.png", Notes: "see https://x.test/page" }),
      row({ Name: "B", Picture: "vz-storage:w/b.png", Notes: "" }),
    ];
    expect(detectLensImageColumn(rows, ["Name", "Picture", "Notes"])).toBe("Picture");
    expect(detectLensImageColumn(rows.map((r) => row({ Name: String(r.originalData.Name) })), ["Name"], ["imageUrls"])).toBe("imageUrls");
    expect(detectLensImageColumn(rows.map((r) => row({ Name: String(r.originalData.Name) })), ["Name"])).toBeNull();
  });

  it("does not take a text column that only mentions a page link", () => {
    expect(detectLensImageColumn([row({ Notes: "see https://x.test/page" })], ["Notes"])).toBeNull();
    expect(detectLensImageColumn([row({ "Image Src": "https://cdn.test/img?id=1" })], ["Image Src"])).toBe("Image Src");
  });
});

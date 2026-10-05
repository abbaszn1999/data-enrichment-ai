import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchApiCallError } from "../image-finder/exact/searchapi";
import { callGoogleLens } from "./searchapi-lens";

const reply = (body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

describe("callGoogleLens", () => {
  beforeEach(() => {
    vi.stubEnv("SEARCHAPI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("treats Success plus \"didn't return any results\" as a billed empty answer, not a failure", async () => {
    vi.stubGlobal(
      "fetch",
      reply({ search_metadata: { status: "Success" }, error: "Google Lens didn't return any results." })
    );
    const result = await callGoogleLens("https://cdn.test/p.jpg", "exact_matches");
    expect(result.matches).toEqual([]);
    expect(result.httpStatus).toBe(200);
  });

  it("still fails on any other error body, unbilled", async () => {
    vi.stubGlobal("fetch", reply({ search_metadata: { status: "Success" }, error: "Invalid image url" }));
    const error = await callGoogleLens("https://cdn.test/p.jpg", "exact_matches").catch((e) => e);
    expect(error).toBeInstanceOf(SearchApiCallError);
    expect((error as SearchApiCallError).billed).toBe(false);
  });

  it("reads product matches with their price and stock, and asks for resolved links only on exact matches", async () => {
    const fetchMock = reply({
      search_metadata: { status: "Success" },
      visual_matches: [{ link: "https://www.walmart.com/ip/toy/1", title: "Toy", price: "$20*", stock_information: "In stock" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await callGoogleLens("https://cdn.test/p.jpg", "products");
    expect(result.matches).toEqual([
      { link: "https://www.walmart.com/ip/toy/1", title: "Toy", price: "$20*", inStock: "In stock" },
    ]);
    const requested = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(requested.searchParams.get("search_type")).toBe("products");
    expect(requested.searchParams.has("link")).toBe(false);

    const exactFetch = reply({ search_metadata: { status: "Success" }, exact_matches: [] });
    vi.stubGlobal("fetch", exactFetch);
    await callGoogleLens("https://cdn.test/p.jpg", "exact_matches");
    expect(new URL(String(exactFetch.mock.calls[0]![0])).searchParams.get("link")).toBe("resolved");
  });

  it("returns resolved exact matches", async () => {
    vi.stubGlobal(
      "fetch",
      reply({
        search_metadata: { status: "Success" },
        exact_matches: [{ link: "https://shop.test/p/1", title: "Widget" }],
      })
    );
    const result = await callGoogleLens("https://cdn.test/p.jpg", "exact_matches");
    expect(result.matches).toEqual([{ link: "https://shop.test/p/1", title: "Widget" }]);
  });
});

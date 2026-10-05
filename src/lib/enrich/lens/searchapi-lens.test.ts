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

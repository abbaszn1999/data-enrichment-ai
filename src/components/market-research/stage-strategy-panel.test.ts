import { describe, expect, it } from "vitest";
import { storefrontHref } from "./stage-strategy-panel";

const STORE = "https://demo-store.myshopify.com";

describe("storefrontHref", () => {
  it("resolves a stored relative path against the storefront", () => {
    expect(storefrontHref(STORE, "/collections/ai-chargers-and-cables")).toBe(
      `${STORE}/collections/ai-chargers-and-cables`
    );
  });

  it("tolerates a trailing slash on the store url and a missing leading slash", () => {
    expect(storefrontHref(`${STORE}/`, "collections/cables")).toBe(
      `${STORE}/collections/cables`
    );
  });

  it("leaves absolute urls untouched", () => {
    const absolute = "https://example.com/collections/cables";
    expect(storefrontHref(STORE, absolute)).toBe(absolute);
  });

  it("returns nothing rather than a link back into the dashboard", () => {
    expect(storefrontHref("", "/collections/cables")).toBe("");
    expect(storefrontHref(STORE, "")).toBe("");
  });
});

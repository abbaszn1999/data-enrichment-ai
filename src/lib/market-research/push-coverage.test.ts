import { describe, expect, it } from "vitest";
import { isPushedCollection } from "./push-coverage";

describe("push coverage", () => {
  it("treats a collection as paid only once the push saved a store id", () => {
    expect(isPushedCollection({})).toBe(false);
    expect(isPushedCollection(null)).toBe(false);
    expect(isPushedCollection({ storeHandle: "ai-rugs" })).toBe(true);
    expect(isPushedCollection({ storeCollectionId: "gid://shopify/Collection/1" })).toBe(true);
  });
});

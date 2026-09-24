import { describe, expect, it } from "vitest";
import { imageFinderNotFoundKey } from "./not-found";

describe("imageFinderNotFoundKey", () => {
  it("derives a sibling key that is never a real column id", () => {
    expect(imageFinderNotFoundKey("imageUrls")).toBe("imageUrls__notFoundReason");
  });

  it("is stable and column-specific", () => {
    expect(imageFinderNotFoundKey("imageUrls")).not.toBe(imageFinderNotFoundKey("categories"));
  });
});

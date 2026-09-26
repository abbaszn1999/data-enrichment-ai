import { describe, expect, it } from "vitest";
import {
  imageFinderMatchBasisKey,
  imageFinderMatchNoteKey,
  imageFinderNotFoundKey,
  imageMatchLabel,
  isApproximateImageMatch,
} from "./not-found";

describe("imageFinderNotFoundKey", () => {
  it("derives a sibling key that is never a real column id", () => {
    expect(imageFinderNotFoundKey("imageUrls")).toBe("imageUrls__notFoundReason");
  });

  it("is stable and column-specific", () => {
    expect(imageFinderNotFoundKey("imageUrls")).not.toBe(imageFinderNotFoundKey("categories"));
  });
});

describe("match type keys and labels", () => {
  it("derives sibling keys for the match basis and note", () => {
    expect(imageFinderMatchBasisKey("imageUrls")).toBe("imageUrls__matchBasis");
    expect(imageFinderMatchNoteKey("imageUrls")).toBe("imageUrls__matchNote");
  });

  it("labels every match weaker than an exact code, and never an exact one", () => {
    expect(isApproximateImageMatch("identifier")).toBe(false);
    expect(isApproximateImageMatch("")).toBe(false);
    expect(isApproximateImageMatch(undefined)).toBe(false);
    expect(imageMatchLabel("near_identifier")).toBe("Near code");
    expect(imageMatchLabel("best_match")).toBe("Best match");
    expect(imageMatchLabel("model_variant")).toBe("Model match");
    expect(imageMatchLabel("identifier")).toBe("");
    for (const basis of ["near_identifier", "best_match", "model_variant"]) {
      expect(isApproximateImageMatch(basis)).toBe(true);
    }
  });
});

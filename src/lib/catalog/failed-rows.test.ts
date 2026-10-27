import { describe, expect, it } from "vitest";
import { failedInTool, failureToolOf, tagRowFailure, toolForRunColumns } from "./failed-rows";

describe("failed rows by tool", () => {
  it("names the tool a run belongs to from its output columns", () => {
    expect(toolForRunColumns(["sourceUrls"])).toBe("Source Finder");
    expect(toolForRunColumns([PRODUCT_IMAGES, "imageSourceUrls"])).toBe("Image Finder");
    expect(toolForRunColumns(["lensFounds"])).toBe("Lens Source Checker");
    expect(toolForRunColumns(["title", "description"])).toBe("Enrichment");
    expect(toolForRunColumns([])).toBe("Enrichment");
  });

  it("writes the tool in front of the message once", () => {
    const tagged = tagRowFailure("Source Finder", "The web search failed.");
    expect(tagged).toBe("Source Finder: The web search failed.");
    expect(tagRowFailure("Source Finder", tagged)).toBe(tagged);
    expect(failureToolOf(tagged)).toBe("Source Finder");
    expect(failureToolOf("Something old")).toBeNull();
  });

  it("counts a failed row only in the tool it failed in, and old failures in every tool", () => {
    const sourceFailure = { status: "error", errorMessage: "Source Finder: The web search failed." };
    expect(failedInTool(sourceFailure, "Source Finder")).toBe(true);
    expect(failedInTool(sourceFailure, "Image Finder")).toBe(false);
    expect(failedInTool({ status: "error", errorMessage: "Old failure" }, "Image Finder")).toBe(true);
    expect(failedInTool({ status: "done", errorMessage: "Source Finder: x" }, "Source Finder")).toBe(false);
  });
});

const PRODUCT_IMAGES = "imageUrls";

import { describe, expect, it } from "vitest";
import { buildImageFinderBrief, IMAGE_FINDER_MAX_IMAGES } from "./brief";

describe("buildImageFinderBrief", () => {
  it("lists every column flat, in sheet order, with no identity/other split", () => {
    const brief = buildImageFinderBrief({
      rowData: {
        Description: "<p>Lightweight <b>running</b> shoe</p>",
        Vendor: "Nike",
        "Variant SKU": "NK-123-RED-42",
        Title: "Air Zoom Pegasus 41",
        "Product Type": "Running Shoes",
        "Option1 Value": "Red",
        Size: "42",
        MPN: "FD2722-600",
        Barcode: "0196975123456",
        "Image Src": "https://cdn.example.com/pegasus.jpg",
      },
      customInstruction: "  White background, front view first  ",
    });

    const order = [
      "## Product data",
      "## Reference image",
      "## Number of images",
      "## Custom instruction",
    ].map((heading) => brief.text.indexOf(heading));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // No categorization: every non-image column appears as its own plain
    // line under its own column name, in the sheet's own order, with no
    // "Brand" / "SKU" relabeling and no separate Variant section.
    expect(brief.text).not.toContain("## Product identity");
    expect(brief.text).not.toContain("## Other product data");
    expect(brief.text).not.toContain("- Variant:");
    expect(brief.text).toContain("- Vendor: Nike");
    expect(brief.text).toContain("- Variant SKU: NK-123-RED-42");
    expect(brief.text).toContain("- Title: Air Zoom Pegasus 41");
    expect(brief.text).toContain("- Product Type: Running Shoes");
    expect(brief.text).toContain("- Option1 Value: Red");
    expect(brief.text).toContain("- Size: 42");
    expect(brief.text).toContain("- MPN: FD2722-600");
    expect(brief.text).toContain("- Barcode: 0196975123456");
    expect(brief.text).toContain("- Description: Lightweight running shoe");

    const fieldOrder = ["Description", "Vendor", "Variant SKU", "Title", "Product Type"].map(
      (key) => brief.text.indexOf(`- ${key}:`)
    );
    expect([...fieldOrder].sort((a, b) => a - b)).toEqual(fieldOrder);

    expect(brief.text).toContain("1 reference image is attached");
    expect(brief.text).toContain(
      "Return every distinct image of this exact item that its verified sources show, up to 7."
    );
    expect(brief.text).toContain(
      "## Custom instruction (store owner, highest priority)\nWhite background, front view first"
    );
    expect(brief.text).not.toContain("https://cdn.example.com/pegasus.jpg");
    expect(brief.referenceImageUrls).toEqual(["https://cdn.example.com/pegasus.jpg"]);
    expect(brief.imageCount).toBe(IMAGE_FINDER_MAX_IMAGES);
  });

  it("omits the custom instruction section when it is empty", () => {
    const brief = buildImageFinderBrief({
      rowData: { Title: "Widget" },
      customInstruction: "   ",
    });
    expect(brief.text).not.toContain("## Custom instruction");
    expect(brief.text).toContain("up to 7");
    expect(brief.text).toContain("None attached.");
  });

  it("falls back to a placeholder line when there is no usable product data", () => {
    const brief = buildImageFinderBrief({ rowData: { Empty: "" } });
    expect(brief.text).toContain("No usable product data was provided.");
  });

  it("keeps __EMPTY-style column names readable", () => {
    const brief = buildImageFinderBrief({ rowData: { __EMPTY_2: "Blue kettle 1.7L" } });
    expect(brief.text).toContain("- Col 2: Blue kettle 1.7L");
  });

  it("adds enforced website rules after the custom instruction", () => {
    const brief = buildImageFinderBrief({
      rowData: { Title: "Robot kit" },
      customInstruction: "This is a toys store",
      allowedDomains: ["lego.com", "hasbro.com"],
      blockedDomains: ["pinterest.com"],
    });
    const custom = brief.text.indexOf("## Custom instruction");
    const rules = brief.text.indexOf("## Website rules (enforced)");
    expect(custom).toBeGreaterThan(0);
    expect(rules).toBeGreaterThan(custom);
    expect(brief.text).toContain(
      "- Only use images from: lego.com, hasbro.com (subdomains included)"
    );
    expect(brief.text).toContain("- Never use images from: pinterest.com");
  });

  it("lists row identifiers, sheet-learned websites and the re-check hint after the website rules", () => {
    const brief = buildImageFinderBrief({
      rowData: { Code: "RCP1151426" },
      rowIdentifiers: ["RCP1151426", "3000000071502"],
      learnedDomains: ["store.test", "shop.test"],
      recheck: true,
    });
    expect(brief.text).toContain("## Row identifiers\nCode-like values in this row");
    expect(brief.text).toContain("RCP1151426, 3000000071502");
    expect(brief.text).toContain("## Websites where other products of this sheet were verified\nstore.test, shop.test");
    expect(brief.text).toContain("## Final re-check");
  });

  it("tells the agent to use best-match rules when the row has no code", () => {
    const brief = buildImageFinderBrief({ rowData: { Description: "Unicorn plush toy" }, rowIdentifiers: [] });
    expect(brief.text).toContain("## Row identifiers\nNone: this row has no SKU, barcode or model code");
    expect(brief.text).toContain("matchBasis best_match");
    const unspecified = buildImageFinderBrief({ rowData: { Description: "Unicorn plush toy" } });
    expect(unspecified.text).not.toContain("## Row identifiers");
  });

  it("does not add sheet-learned websites when the owner set an allow list", () => {
    const brief = buildImageFinderBrief({
      rowData: { Code: "RCP1151426" },
      allowedDomains: ["store.test"],
      learnedDomains: ["other.test"],
    });
    expect(brief.text).not.toContain("other.test");
  });

  it("caps reference images at four", () => {
    const rowData: Record<string, string> = {};
    for (let i = 0; i < 6; i += 1) rowData[`img${i}`] = `https://cdn.example.com/${i}.png`;
    expect(buildImageFinderBrief({ rowData }).referenceImageUrls).toHaveLength(4);
  });
});

describe("IMAGE_FINDER_MAX_IMAGES", () => {
  it("is a fixed limit of 7 images per item", () => {
    expect(IMAGE_FINDER_MAX_IMAGES).toBe(7);
  });
});

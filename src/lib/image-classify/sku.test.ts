import { describe, expect, it } from "vitest";
import {
  humanizeFilename,
  imageCaption,
  sanitizeSku,
} from "@/lib/image-classify/sku";

describe("sanitizeSku", () => {
  it("rejects full descriptive filenames used as SKU", () => {
    expect(
      sanitizeSku(
        "Technical-SEO-Mastery-for-eCom-Brands",
        "Technical-SEO-Mastery-for-eCom-Brands.png"
      )
    ).toBe("");
    expect(
      sanitizeSku("Ecommerce-SEO-EBOOK", "Ecommerce-SEO-EBOOK.png")
    ).toBe("");
    expect(
      sanitizeSku("The-AI-Commerce-Playbook", "The-AI-Commerce-Playbook.png")
    ).toBe("");
  });

  it("keeps real product codes", () => {
    expect(sanitizeSku("COSH261032-RAIN-11", "front.jpg")).toBe(
      "COSH261032-RAIN-11"
    );
    expect(sanitizeSku("HK5000030_584", "side.png")).toBe("HK5000030_584");
    expect(sanitizeSku("cw637", "detail.webp")).toBe("cw637");
  });

  it("rejects sku equal to filename stem", () => {
    expect(sanitizeSku("Product-Name", "Product-Name.jpg")).toBe("");
  });
});

describe("imageCaption", () => {
  it("falls back to humanized filename when sku is a title", () => {
    const caption = imageCaption(
      "Technical-SEO-Mastery-for-eCom-Brands",
      "Technical-SEO-Mastery-for-eCom-Brands.png"
    );
    expect(caption.isSku).toBe(false);
    expect(caption.primary).toBe("Technical SEO Mastery for eCom Brands");
  });

  it("humanizeFilename replaces separators", () => {
    expect(humanizeFilename("The-Click-Engine_Guide.png")).toBe(
      "The Click Engine Guide"
    );
  });
});

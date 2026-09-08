import { describe, expect, it } from "vitest";
import {
  ensureTermInAltText,
  ensureTermInSeoDescription,
  ensureTermInSeoTitle,
  stripUnauthorizedLinks,
} from "./stage7-article-writer";

describe("ensureTermInSeoTitle", () => {
  it("is a no-op when the term is already present", () => {
    const title = "Best Ceramic Coffee Mugs for Every Morning";
    expect(ensureTermInSeoTitle(title, "ceramic coffee mugs")).toBe(title);
  });

  it("is case-insensitive when checking for the term", () => {
    const title = "Best CERAMIC COFFEE MUGS for Every Morning";
    expect(ensureTermInSeoTitle(title, "ceramic coffee mugs")).toBe(title);
  });

  it("rebuilds as term-led when the term is missing", () => {
    const result = ensureTermInSeoTitle("A Great Morning Routine", "ceramic coffee mugs");
    expect(result.toLowerCase()).toContain("ceramic coffee mugs");
    expect(result.toLowerCase().indexOf("ceramic coffee mugs")).toBe(0);
  });

  it("respects the max length cap", () => {
    const longTitle = "A".repeat(80);
    const result = ensureTermInSeoTitle(longTitle, "ceramic coffee mugs", 60);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it("still clamps a too-long title even when the term is present", () => {
    const longTitle = `ceramic coffee mugs ${"x".repeat(80)}`;
    const result = ensureTermInSeoTitle(longTitle, "ceramic coffee mugs", 60);
    expect(result.length).toBeLessThanOrEqual(60);
  });
});

describe("ensureTermInSeoDescription", () => {
  it("is a no-op when the term is already present", () => {
    const description =
      "Shop our ceramic coffee mugs collection for durable, dishwasher-safe designs.";
    expect(ensureTermInSeoDescription(description, "ceramic coffee mugs")).toBe(
      description
    );
  });

  it("blends the term in when missing", () => {
    const result = ensureTermInSeoDescription(
      "Durable, dishwasher-safe designs for every kitchen.",
      "ceramic coffee mugs"
    );
    expect(result.toLowerCase()).toContain("ceramic coffee mugs");
  });

  it("respects the max length cap", () => {
    const longDescription = "A".repeat(200);
    const result = ensureTermInSeoDescription(
      longDescription,
      "ceramic coffee mugs",
      160
    );
    expect(result.length).toBeLessThanOrEqual(160);
  });
});

describe("ensureTermInAltText", () => {
  it("is a no-op when an image already mentions the term", () => {
    const images = [
      { url: "https://example.com/a.jpg", alt: "A set of ceramic coffee mugs" },
      { url: "https://example.com/b.jpg", alt: "A kitchen counter" },
    ];
    expect(ensureTermInAltText(images, "ceramic coffee mugs")).toEqual(images);
  });

  it("extends the first image's alt when no image mentions the term", () => {
    const images = [
      { url: "https://example.com/a.jpg", alt: "A kitchen counter" },
      { url: "https://example.com/b.jpg", alt: "A cozy breakfast nook" },
    ];
    const result = ensureTermInAltText(images, "ceramic coffee mugs");
    expect(result[0].alt.toLowerCase()).toContain("ceramic coffee mugs");
    expect(result[1]).toEqual(images[1]);
  });

  it("is a no-op on an empty image list", () => {
    expect(ensureTermInAltText([], "ceramic coffee mugs")).toEqual([]);
  });
});

describe("stripUnauthorizedLinks", () => {
  it("keeps both a collection href and a product href", () => {
    const html =
      '<p>Browse our <a href="/collections/mugs">mug collection</a> or grab the ' +
      '<a href="/products/blue-mug">Blue Ceramic Mug</a> directly.</p>';
    const allowed = ["/collections/mugs", "/products/blue-mug"];
    expect(stripUnauthorizedLinks(html, allowed)).toBe(html);
  });

  it("strips an invented link but keeps its anchor text", () => {
    const html =
      '<p>Check out <a href="https://example.com/random">this other site</a> too.</p>';
    const result = stripUnauthorizedLinks(html, ["/collections/mugs"]);
    expect(result).toBe("<p>Check out this other site too.</p>");
  });

  it("strips only the unauthorized link among several", () => {
    const html =
      '<a href="/collections/mugs">Mugs</a> and <a href="https://evil.com">bad</a> and ' +
      '<a href="/products/blue-mug">Blue Mug</a>';
    const result = stripUnauthorizedLinks(html, [
      "/collections/mugs",
      "/products/blue-mug",
    ]);
    expect(result).toBe(
      '<a href="/collections/mugs">Mugs</a> and bad and <a href="/products/blue-mug">Blue Mug</a>'
    );
  });
});

import { describe, expect, it } from "vitest";
import { extractHtmlPage, extractJsonPage } from "./page-extract";

const BASE = "https://store.test/products/claw-clip";

describe("extractHtmlPage", () => {
  it("reads JSON-LD products, OpenGraph, gallery srcset and site search forms on any platform", () => {
    const html = `<html><head><title>Plush Cartoon Hair Claw Clip</title>
      <meta property="og:image" content="//cdn.test/og-main-1774603090.jpg">
      <script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Plush Cartoon Hair Claw Clip","sku":"YWP1624777","gtin13":"3000000058916","brand":{"name":"Paktat"},"offers":{"price":"1.99","priceCurrency":"USD"},"image":["/files/clip-a-2026.jpg"]}]}</script>
      </head><body>
      <img srcset="/files/clip-b-2026_200x.jpg 200w, /files/clip-b-2026_1200x.jpg 1200w" src="/files/clip-b-2026_200x.jpg">
      <form action="/search" method="get"><input type="hidden" name="type" value="product"><input name="q"></form>
      <a href="/collections/hair">Hair accessories</a><a href="https://elsewhere.test/x">Other</a>
      <p>Price $1.99</p></body></html>`;
    const page = extractHtmlPage(html, BASE);
    expect(page.title).toBe("Plush Cartoon Hair Claw Clip");
    const ld = page.products.find((p) => p.source === "json-ld");
    expect(ld).toMatchObject({ sku: ["YWP1624777"], gtin: ["3000000058916"], brand: "Paktat", price: "1.99" });
    expect(page.images).toEqual(
      expect.arrayContaining([
        "https://store.test/files/clip-a-2026.jpg",
        "https://cdn.test/og-main-1774603090.jpg",
        "https://store.test/files/clip-b-2026_1200x.jpg",
      ])
    );
    expect(page.searchForms).toEqual([{ urlTemplate: "https://store.test/search?type=product&q={query}" }]);
    expect(page.links[0]).toEqual({ url: "https://store.test/collections/hair", text: "Hair accessories" });
    expect(page.text).toContain("Price $1.99");
    expect(page.text).not.toContain("YWP1624777");
  });

  it("reads microdata and SKU values embedded in inline scripts", () => {
    const html = `<html><body><div itemscope itemtype="https://schema.org/Product">
      <span itemprop="name">Tool Table</span><meta itemprop="sku" content="HSP1616244"></div>
      <script>window.product = {"variants":[{"sku":"HSP1616244","barcode":"3000000057261"}]};</script></body></html>`;
    const page = extractHtmlPage(html, BASE);
    expect(page.products.find((p) => p.source === "microdata")?.sku).toEqual(["HSP1616244"]);
    expect(page.products.find((p) => p.source === "embedded-json")).toMatchObject({
      sku: ["HSP1616244"],
      barcode: ["3000000057261"],
    });
  });
});

describe("productText", () => {
  it("keeps headings and product descriptions, and leaves out navigation menus", () => {
    const html = `<html><head><title>Umbrella – Store</title>
      <meta name="description" content="Kids umbrella with a safety whistle">
      </head><body>
      <nav><a href="/girls">Girls</a><a href="/baby">Baby Dolls</a><div class="product-description">Menu promo</div></nav>
      <h1>Umbrella (Assorted)</h1>
      <div class="product__description">Colourful children's umbrella, 6 designs.</div>
      </body></html>`;
    const page = extractHtmlPage(html, BASE);
    expect(page.productText).toContain("Umbrella (Assorted)");
    expect(page.productText).toContain("Kids umbrella with a safety whistle");
    expect(page.productText).toContain("Colourful children's umbrella, 6 designs.");
    expect(page.productText).not.toContain("Girls");
    expect(page.productText).not.toContain("Menu promo");
    expect(page.text).toContain("Girls");
  });

  it("uses names and HTML descriptions from product JSON", () => {
    const json = JSON.stringify({ product: { title: "Unicorn Plush", vendor: "Cuddle Co", body_html: "<p>Soft <b>rainbow</b> mane</p>", variants: [{ sku: "CUD778812" }] } });
    const page = extractJsonPage(json, "https://store.test/products/unicorn-plush.json");
    expect(page.productText).toBe("Unicorn Plush Cuddle Co Soft rainbow mane");
  });
});

describe("extractJsonPage", () => {
  it("reads product JSON with variants and images", () => {
    const json = JSON.stringify({
      product: {
        title: "Electric Ride-On Bulldozer",
        vendor: "Paktat",
        variants: [{ sku: "RCP1151426", barcode: "3000000071502", price: "299.99" }],
        images: [{ src: "https://cdn.test/files/dozer-1-20260108.jpg" }, { src: "https://cdn.test/files/dozer-2-20260108.jpg" }],
      },
    });
    const page = extractJsonPage(json, "https://store.test/products/electric-ride-on-bulldozer.json");
    expect(page.products[0]).toMatchObject({
      name: "Electric Ride-On Bulldozer",
      sku: ["RCP1151426"],
      barcode: ["3000000071502"],
      brand: "Paktat",
    });
    expect(page.images).toEqual([
      "https://cdn.test/files/dozer-1-20260108.jpg",
      "https://cdn.test/files/dozer-2-20260108.jpg",
    ]);
  });
});

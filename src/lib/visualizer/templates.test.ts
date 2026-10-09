import { describe, expect, it } from "vitest";
import { VISUALIZER_LAYOUT_IDS, VISUALIZER_LAYOUTS, visualizerUserCount } from "./layouts";
import {
  clampText,
  detectTextDirection,
  renderVisualizerPage,
  toPlainText,
  type VisualizerPageCopy,
} from "./templates";

function showcaseCopy(n: number): VisualizerPageCopy {
  return {
    headline: "Trail Runner GTX",
    intro: "Stay dry on every run.",
    closing: "",
    sections: [],
    showcase: {
      tagline: "Trail Runner",
      badge: "Waterproof",
      highlights: [
        { value: "280 g", label: "Light on the trail" },
        { value: "GTX", label: "Sealed membrane" },
      ],
      promise: "2-year warranty",
      galleryCount: n - 2,
    },
  };
}

function copy(n: number): VisualizerPageCopy {
  return {
    headline: "Trail Runner GTX",
    intro: "Stay dry on every run.",
    closing: "",
    sections: Array.from({ length: n }, (_, i) => ({
      heading: `Claim ${i + 1}`,
      body: `Body ${i + 1}`,
      bullets: i === 0 ? ["Point A"] : [],
    })),
  };
}

const markerPositions = (html: string, n: number) =>
  Array.from({ length: n }, (_, i) => html.indexOf(`[imageplaceholder-${i + 1}]`));

describe("renderVisualizerPage", () => {
  for (const layoutId of VISUALIZER_LAYOUT_IDS) {
    const layout = VISUALIZER_LAYOUTS[layoutId];
    const pageCopy = layoutId === "showcase" ? showcaseCopy : copy;
    for (let n = layout.minImages; n <= layout.maxImages; n += 1) {
      it(`${layoutId} with ${n} images places every marker once, in order`, () => {
        const html = renderVisualizerPage(layoutId, pageCopy(n), { direction: "ltr" });
        for (let index = 1; index <= n; index += 1) {
          expect(html.split(`[imageplaceholder-${index}]`)).toHaveLength(2);
          if (layoutId !== "showcase") expect(html).toContain(`Claim ${index}`);
        }
        expect(html).not.toContain(`[imageplaceholder-${n + 1}]`);
        const positions = markerPositions(html, n);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(html).toBe(renderVisualizerPage(layoutId, pageCopy(n), { direction: "ltr" }));
      });
    }
  }

  it("builds the showcase banner: strip, scene, product card, tiles, promise and a swipe gallery", () => {
    const html = renderVisualizerPage("showcase", showcaseCopy(5), {
      direction: "ltr",
      brandColors: ["#0B3D2E", "#2563EB", "#F6D04D"],
    });
    expect(html.split(">Trail Runner</span>").length).toBeGreaterThan(4);
    expect(html).toContain("Waterproof");
    expect(html).toContain("280 g");
    expect(html).toContain("2-year warranty");
    expect(html).toContain("scroll-snap-type:x mandatory");
    expect(html).toContain("aspect-ratio:4/5");
    expect(html).toContain("background:#F6D04D");
    expect(html).not.toMatch(/<script|<button|onclick/);
  });

  it("deepens a light showcase colour instead of replacing it", () => {
    const html = renderVisualizerPage("showcase", showcaseCopy(5), { direction: "ltr", brandColors: ["#A3C585", "", "#FFD6A5"] });
    expect(html).not.toContain("#1F3D2E");
    expect(html).not.toContain("color:#A3C585");
    expect(html).toContain("background:#FFD6A5");
  });

  it("rejects showcase without banner copy or with a gallery that does not fit", () => {
    expect(() => renderVisualizerPage("showcase", copy(5), { direction: "ltr" })).toThrow();
    const tooMany = showcaseCopy(5);
    tooMany.showcase!.galleryCount = 9;
    expect(() => renderVisualizerPage("showcase", tooMany, { direction: "ltr" })).toThrow();
  });

  it("alternates zigzag rows: image first on odd slots, copy first on even slots", () => {
    const html = renderVisualizerPage("zigzag", copy(4), { direction: "ltr" });
    const rows = html.split("<section").slice(1);
    rows.forEach((row, i) => {
      const imageFirst = row.indexOf("[imageplaceholder-") < row.indexOf("<h3");
      expect(imageFirst).toBe(i % 2 === 0);
    });
  });

  it("is the same structure for every product; only the text changes", () => {
    const a = renderVisualizerPage("feature-grid", copy(3), { direction: "ltr" });
    const other = copy(3);
    other.headline = "Another product";
    other.sections = other.sections.map((section, i) => ({ ...section, heading: `Other ${i}`, body: `Other body ${i}` }));
    const b = renderVisualizerPage("feature-grid", other, { direction: "ltr" });
    const skeleton = (html: string) => html.replace(/>[^<]*</g, "><");
    expect(skeleton(a)).toBe(skeleton(b));
  });

  it("sets the page direction", () => {
    expect(renderVisualizerPage("zigzag", copy(2), { direction: "rtl" })).toMatch(/^<article dir="rtl"[^>]*text-align:right/);
    expect(renderVisualizerPage("zigzag", copy(2), { direction: "ltr" })).toMatch(/^<article dir="ltr"/);
  });

  it("uses a dark primary for headings and the accent for the line", () => {
    const html = renderVisualizerPage("zigzag", copy(2), {
      direction: "ltr",
      brandColors: ["#111827", "#2563EB", "#F59E0B"],
    });
    expect(html).toContain("color:#111827");
    expect(html).toContain("background:#F59E0B");
  });

  it("keeps headings readable when the primary colour is light, and ignores invalid colours", () => {
    const light = renderVisualizerPage("zigzag", copy(2), { direction: "ltr", brandColors: ["#FFFFFF", "", "#F59E0B"] });
    expect(light).not.toContain("color:#FFFFFF");
    const invalid = renderVisualizerPage("zigzag", copy(2), {
      direction: "ltr",
      brandColors: ["red;background:url(x)", "x", "javascript:alert(1)"],
    });
    expect(invalid).not.toContain("url(x)");
    expect(invalid).not.toContain("javascript");
  });

  it("escapes every text field", () => {
    const html = renderVisualizerPage(
      "zigzag",
      { ...copy(2), headline: '<b onclick="x">Hi</b>', closing: "5 > 4 & 'ok'" },
      { direction: "ltr" }
    );
    expect(html).toContain("&lt;b onclick=&quot;x&quot;&gt;Hi&lt;/b&gt;");
    expect(html).toContain("5 &gt; 4 &amp; &#39;ok&#39;");
  });

  it("rejects a section count the layout cannot hold", () => {
    expect(() => renderVisualizerPage("spotlight", copy(5), { direction: "ltr" })).toThrow(/cannot hold 5/);
  });
});

describe("visualizerUserCount", () => {
  it("counts only the gallery photos for Showcase", () => {
    expect(visualizerUserCount("showcase", 6)).toBe(4);
    expect(visualizerUserCount("showcase", VISUALIZER_LAYOUTS.showcase.minImages)).toBe(2);
    expect(visualizerUserCount("showcase", VISUALIZER_LAYOUTS.showcase.maxImages)).toBe(6);
    expect(visualizerUserCount("zigzag", 4)).toBe(4);
  });
});

describe("text helpers", () => {
  it("strips tags, markdown and markers but keeps comparisons", () => {
    expect(toPlainText("<p>**Bold** `code`</p> [imageplaceholder-2] size < 10 and > 5")).toBe(
      "Bold code size < 10 and > 5"
    );
  });

  it("cuts at a sentence end, else at a word boundary", () => {
    expect(clampText("One two. Three four five six.", 12)).toBe("One two.");
    expect(clampText("alpha beta gamma delta epsilon", 18)).toBe("alpha beta gamma…");
    expect(clampText("short", 20)).toBe("short");
  });

  it("detects right-to-left copy", () => {
    expect(detectTextDirection(["حذاء مقاوم للماء", "Gore-Tex"])).toBe("rtl");
    expect(detectTextDirection(["Waterproof shoe", "مقاوم"])).toBe("ltr");
    expect(detectTextDirection(["123"])).toBe("ltr");
  });
});

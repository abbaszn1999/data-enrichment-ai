import { describe, expect, it } from "vitest";
import {
  buildAiImageResponseFormat,
  geminiImageSize,
  referenceFlags,
  type AiReferenceImage,
} from "./ai-shared";
import { orderReferences, selectShotReferences } from "@/lib/ai-images/reference-set";

const ref = (role: AiReferenceImage["role"], key: string): AiReferenceImage => ({
  role,
  key,
  label: role,
  contentType: "image/jpeg",
  buffer: Buffer.from("x"),
});

describe("geminiImageSize", () => {
  it("maps 0.5K to 512 on Nano Banana 2 only", () => {
    expect(geminiImageSize("0.5K", "gemini-3.1-flash-image")).toBe("512");
    expect(geminiImageSize("0.5K", "gemini-3-pro-image")).toBe("1K");
  });
  it("passes 1K, 2K and 4K through", () => {
    expect(geminiImageSize("1K", "gemini-3-pro-image")).toBe("1K");
    expect(geminiImageSize("2K", "gemini-3.1-flash-image")).toBe("2K");
    expect(geminiImageSize("4K", "gemini-3-pro-image")).toBe("4K");
  });
});

describe("buildAiImageResponseFormat", () => {
  it("sends aspect ratio, size and the JPEG mime type", () => {
    expect(
      buildAiImageResponseFormat(
        { aspectRatio: "4:5", resolution: "2K", outputFormat: "image/jpeg" },
        "gemini-3.1-flash-image"
      )
    ).toEqual({ type: "image", aspect_ratio: "4:5", image_size: "2K", mime_type: "image/jpeg" });
  });
  it("omits mime_type for PNG (converted after the call) and rejects unknown ratios", () => {
    const format = buildAiImageResponseFormat(
      { aspectRatio: "7:5", resolution: "0.5K", outputFormat: "image/png" },
      "gemini-3.1-flash-image"
    );
    expect(format).toEqual({ type: "image", aspect_ratio: "1:1", image_size: "512" });
  });
});

describe("reference sets", () => {
  const all = [
    ref("logo", "logo.png"),
    ref("product", "p1"),
    ref("brandGuide", "guide.png"),
    ref("product", "p2"),
    ref("model", "model.jpg"),
    ref("product", "p3"),
    ref("product", "p4"),
    ref("product", "p5"),
  ];

  it("orders products, model, brand guide, logo and caps products at four", () => {
    const ordered = orderReferences(all);
    expect(ordered.map((r) => r.role)).toEqual([
      "product", "product", "product", "product", "model", "brandGuide", "logo",
    ]);
    expect(ordered[0].key).toBe("p1");
  });

  it("drops the logo unless the shot uses it, without renumbering the others", () => {
    const ordered = orderReferences(all);
    const without = selectShotReferences(ordered, { useLogo: false });
    const withLogo = selectShotReferences(ordered, { useLogo: true });
    expect(without.some((r) => r.role === "logo")).toBe(false);
    expect(withLogo.slice(0, without.length).map((r) => r.key)).toEqual(without.map((r) => r.key));
    expect(withLogo.at(-1)?.role).toBe("logo");
  });

  it("detects roles from the typed role, not the label", () => {
    const flags = referenceFlags(orderReferences(all));
    expect(flags).toMatchObject({ hasSceneReference: true, hasLogo: true, hasBrandGuide: true });
  });
});

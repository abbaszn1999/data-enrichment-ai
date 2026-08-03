import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  assertVisionPayloadLimit,
  computeDHash,
  hammingDistance,
  isPerceptualDuplicate,
  normalizeGalleryImage,
  VISION_MAX_EDGE,
} from "@/lib/gallery/image-normalization";

async function fixture(format: "png" | "gif" | "avif") {
  const image = sharp({
    create: {
      width: 1_200,
      height: 800,
      channels: 3,
      background: { r: 40, g: 120, b: 220 },
    },
  });
  if (format === "gif") return image.gif().toBuffer();
  if (format === "avif") return image.avif().toBuffer();
  return image.png().toBuffer();
}

describe("gallery image normalization", () => {
  it.each(["png", "gif", "avif"] as const)(
    "normalizes %s into bounded WebP",
    async (format) => {
      const result = await normalizeGalleryImage(await fixture(format));
      expect(result.contentType).toBe("image/webp");
      expect(result.ext).toBe("webp");
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(
        VISION_MAX_EDGE
      );
      expect(result.buffer.length).toBeLessThanOrEqual(1_500_000);
    }
  );

  it("detects resized/recompressed near duplicates", async () => {
    const source = await fixture("png");
    const resized = await sharp(source).resize(600).jpeg({ quality: 55 }).toBuffer();
    const first = await computeDHash(source);
    const second = await computeDHash(resized);
    expect(hammingDistance(first, second)).toBeLessThanOrEqual(6);
    expect(isPerceptualDuplicate(second, [first])).toBe(true);
  });

  it("enforces the aggregate 20MB vision limit", () => {
    expect(() =>
      assertVisionPayloadLimit([
        Buffer.alloc(10 * 1024 * 1024),
        Buffer.alloc(10 * 1024 * 1024 + 1),
      ])
    ).toThrow(/20MB/);
  });
});

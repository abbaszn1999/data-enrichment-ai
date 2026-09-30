import sharp from "sharp";

const REFERENCE_MAX_EDGE = 2048;

/**
 * Make a reference image safe to send to OpenAI and Gemini: apply EXIF rotation,
 * cap the longest edge, and convert unusual formats. Images with transparency
 * (logos) stay PNG so the transparent area is not turned black; everything else
 * becomes JPEG. The stored original is never touched.
 */
export async function prepareReferenceImage(
  input: Buffer
): Promise<{ buffer: Buffer; contentType: "image/jpeg" | "image/png" }> {
  const image = sharp(input, { failOn: "error", animated: false, limitInputPixels: 80_000_000 });
  const metadata = await image.metadata();
  const pipeline = image
    .rotate()
    .resize({
      width: REFERENCE_MAX_EDGE,
      height: REFERENCE_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    });
  if (metadata.hasAlpha) {
    return { buffer: await pipeline.png({ compressionLevel: 8 }).toBuffer(), contentType: "image/png" };
  }
  return { buffer: await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer(), contentType: "image/jpeg" };
}

export function bufferToDataUrl(buffer: Buffer, contentType: string): string {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

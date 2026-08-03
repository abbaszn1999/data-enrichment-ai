import { createHash } from "node:crypto";
import sharp from "sharp";

export const VISION_MAX_EDGE = 768;
export const VISION_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const NORMALIZED_TARGET_BYTES = 1_500_000;
export const DEFAULT_DHASH_THRESHOLD = 6;

export type NormalizedGalleryImage = {
  buffer: Buffer;
  contentType: "image/webp";
  ext: "webp";
  width: number;
  height: number;
  sha256: string;
  dHash: string;
};

export async function normalizeGalleryImage(
  input: Buffer,
  options: { maxEdge?: number; targetBytes?: number } = {}
): Promise<NormalizedGalleryImage> {
  if (!input.length) throw new Error("Image is empty");
  const maxEdge = options.maxEdge ?? VISION_MAX_EDGE;
  const targetBytes = options.targetBytes ?? NORMALIZED_TARGET_BYTES;

  const base = sharp(input, {
    failOn: "error",
    animated: false,
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });

  let buffer = Buffer.alloc(0);
  let quality = 86;
  while (quality >= 48) {
    buffer = await base.clone().webp({ quality, effort: 4, smartSubsample: true }).toBuffer();
    if (buffer.length <= targetBytes) break;
    quality -= 8;
  }
  if (buffer.length > targetBytes) {
    buffer = await base
      .clone()
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 46, effort: 5, smartSubsample: true })
      .toBuffer();
  }
  if (buffer.length > targetBytes) {
    throw new Error("Image cannot be normalized within the payload limit");
  }

  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < 1 || height < 1) throw new Error("Normalized image has invalid dimensions");

  return {
    buffer,
    contentType: "image/webp",
    ext: "webp",
    width,
    height,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    dHash: await computeDHash(buffer),
  };
}

export async function computeDHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = BigInt(0);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = data[y * 9 + x];
      const right = data[y * 9 + x + 1];
      bits =
        (bits << BigInt(1)) | (left > right ? BigInt(1) : BigInt(0));
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hammingDistance(hashA: string, hashB: string): number {
  let value = BigInt(`0x${hashA || "0"}`) ^ BigInt(`0x${hashB || "0"}`);
  let distance = 0;
  while (value > BigInt(0)) {
    distance += Number(value & BigInt(1));
    value >>= BigInt(1);
  }
  return distance;
}

export function isPerceptualDuplicate(
  hash: string,
  existing: Iterable<string>,
  threshold = DEFAULT_DHASH_THRESHOLD
): boolean {
  for (const candidate of existing) {
    if (hammingDistance(hash, candidate) <= threshold) return true;
  }
  return false;
}

export function assertVisionPayloadLimit(buffers: Buffer[]): void {
  const total = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  if (total > VISION_MAX_TOTAL_BYTES) {
    throw new Error("Vision image payload exceeds 20MB");
  }
}

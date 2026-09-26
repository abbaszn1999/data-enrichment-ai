import sharp from "sharp";
import { mapLimit } from "@/lib/async/map-limit";
import type { EnrichFunctionTool, EnrichToolOutput } from "../../openai";
import { readCapped, safeFetch } from "./url-safety";

export const VIEW_IMAGES_TOOL_NAME = "view_images";

const MAX_IMAGES_PER_CALL = 8;
const DEFAULT_MAX_VIEWS = 24;
const MAX_IMAGE_BYTES = 10_000_000;
const PREVIEW_EDGE = 640;
const TIMEOUT_MS = 12_000;

export interface ViewedImage {
  url: string;
  ok: boolean;
  width?: number;
  height?: number;
  dataUrl?: string;
  error?: string;
}

export async function loadImagePreview(url: string): Promise<ViewedImage> {
  try {
    const { response } = await safeFetch(url, {
      headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { url, ok: false, error: `HTTP ${response.status}` };
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      await response.body?.cancel().catch(() => undefined);
      return { url, ok: false, error: `Not an image (${contentType || "unknown type"})` };
    }
    const buffer = await readCapped(response, MAX_IMAGE_BYTES);
    if (!buffer) return { url, ok: false, error: "Image too large" };
    const image = sharp(buffer, { failOn: "none", limitInputPixels: 100_000_000 }).timeout({ seconds: 10 });
    const meta = await image.metadata();
    const preview = await image
      .rotate()
      .resize(PREVIEW_EDGE, PREVIEW_EDGE, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 72 })
      .toBuffer();
    return {
      url,
      ok: true,
      width: meta.width,
      height: meta.height,
      dataUrl: `data:image/jpeg;base64,${preview.toString("base64")}`,
    };
  } catch (error) {
    return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createViewImagesTool(input: {
  maxViews?: number;
  load?: (url: string) => Promise<ViewedImage>;
} = {}): EnrichFunctionTool {
  const maxViews = input.maxViews ?? DEFAULT_MAX_VIEWS;
  const load = input.load ?? loadImagePreview;
  let viewed = 0;
  return {
    name: VIEW_IMAGES_TOOL_NAME,
    description:
      "Look at candidate product images before returning them. Downloads each image link and shows it to you, with its size, so you can keep only real photos of this exact product and variant, and drop banners, placeholders, size charts, watermarked or unrelated images and repeated copies of the same photo.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: `Image links to look at (up to ${MAX_IMAGES_PER_CALL} per call).`,
        },
      },
      required: ["urls"],
    },
    run: async (args) => {
      const requested = Array.isArray(args.urls) ? args.urls.map((u) => String(u).trim()).filter(Boolean) : [];
      const unique = [...new Set(requested)].slice(0, MAX_IMAGES_PER_CALL);
      const allowed = unique.slice(0, Math.max(0, maxViews - viewed));
      viewed += allowed.length;
      if (allowed.length === 0) {
        return JSON.stringify({ error: "Image viewing budget for this product is used up." });
      }
      const results = await mapLimit(allowed, 4, load);
      const output: Exclude<EnrichToolOutput, string> = [];
      results.forEach((result, index) => {
        if (result.ok && result.dataUrl) {
          output.push({
            type: "input_text",
            text: `Image ${index + 1}: ${result.url} (${result.width ?? "?"}x${result.height ?? "?"})`,
          });
          output.push({ type: "input_image", image_url: result.dataUrl, detail: "low" });
        } else {
          output.push({ type: "input_text", text: `Image ${index + 1}: ${result.url} could not be loaded (${result.error}).` });
        }
      });
      if (unique.length > allowed.length) {
        output.push({ type: "input_text", text: `${unique.length - allowed.length} image(s) were not shown: viewing budget reached.` });
      }
      return output;
    },
  };
}

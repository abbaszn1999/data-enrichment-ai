import { prepareReferenceImage } from "@/lib/ai-images/reference-image";
import { MAX_PRODUCT_REFERENCES, orderReferences } from "@/lib/ai-images/reference-set";
import type { AiReferenceImage, AiReferenceRole } from "@/lib/gallery/agents/ai-shared";
import { classifyRowValues } from "@/lib/gallery/agents/gallery-brief";
import { parseImageUrls } from "@/lib/gallery/image-urls";
import { downloadImageBytes } from "@/lib/gallery/providers/serper-images";
import { visualizerWarn } from "@/lib/visualizer/log";
import { downloadVisualizerBytesAdmin } from "@/lib/visualizer/storage-admin";
import type { VisualizerProjectSettings, VisualizerRow } from "@/lib/visualizer/types";

async function toReference(buffer: Buffer, role: AiReferenceRole, key: string): Promise<AiReferenceImage | null> {
  try {
    const prepared = await prepareReferenceImage(buffer);
    return { role, key, label: role, buffer: prepared.buffer, contentType: prepared.contentType };
  } catch (error) {
    visualizerWarn("references", "Reference image could not be read", {
      role,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function loadStoredReference(path: string | null, role: AiReferenceRole): Promise<AiReferenceImage | null> {
  if (!path) return null;
  try {
    const stored = await downloadVisualizerBytesAdmin(path);
    if (!stored) {
      visualizerWarn("references", "Stored reference could not be downloaded", { path, role });
      return null;
    }
    return toReference(stored.buffer, role, path);
  } catch (error) {
    visualizerWarn("references", "Stored reference download failed", {
      path,
      role,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Product photo URLs for a row: the chosen image column first, then other image columns of the selected data. */
export function productImageUrls(
  row: Pick<VisualizerRow, "originalData">,
  settings: Pick<VisualizerProjectSettings, "selectedColumns" | "productImageColumn">
): string[] {
  const urls: string[] = [];
  const push = (url: string) => {
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed) && !urls.includes(trimmed)) urls.push(trimmed);
  };
  if (settings.productImageColumn) {
    for (const url of parseImageUrls(row.originalData[settings.productImageColumn])) push(url);
  }
  const classified = classifyRowValues(row.originalData, settings.selectedColumns);
  for (const url of classified.imageUrls) push(url);
  return urls.slice(0, MAX_PRODUCT_REFERENCES * 2);
}

export interface VisualizerReferenceSet {
  /** Canonical send order: products, brand guide, logo. */
  ordered: AiReferenceImage[];
  productCount: number;
  hasLogo: boolean;
  hasBrandGuide: boolean;
  /** Reference counts by role, for billing details. */
  counts: Record<string, number>;
  /** Stored paths that no longer resolve, so the caller can clear them. */
  staleLogo: boolean;
  staleBrandGuide: boolean;
}

/**
 * Every reference image for one row, in the exact order both the planner and
 * the image model see. The planner and the image phase call this with the same
 * row and settings, so "image 1" means the same picture in both.
 */
export async function loadVisualizerReferences(params: {
  row: Pick<VisualizerRow, "originalData">;
  settings: VisualizerProjectSettings;
}): Promise<VisualizerReferenceSet> {
  const { row, settings } = params;
  const images = settings.images;
  const brandingEnabled = images.brandingEnabled === true;

  const products: AiReferenceImage[] = [];
  for (const url of productImageUrls(row, settings)) {
    if (products.length >= MAX_PRODUCT_REFERENCES) break;
    const downloaded = await downloadImageBytes(url).catch(() => null);
    if (!downloaded) {
      visualizerWarn("references", "Skipping undownloadable product image", { url });
      continue;
    }
    const reference = await toReference(downloaded.buffer, "product", url);
    if (reference) products.push(reference);
  }

  const logo = brandingEnabled ? await loadStoredReference(images.logoPath, "logo") : null;
  const guide =
    brandingEnabled && images.brandGuideMode === "image"
      ? await loadStoredReference(images.brandGuidePath, "brandGuide")
      : null;

  const ordered = orderReferences([...products, guide, logo].filter((value): value is AiReferenceImage => !!value));
  const counts = ordered.reduce<Record<string, number>>((acc, reference) => {
    acc[reference.role] = (acc[reference.role] ?? 0) + 1;
    return acc;
  }, {});

  return {
    ordered,
    productCount: products.length,
    hasLogo: !!logo,
    hasBrandGuide: !!guide,
    counts,
    staleLogo: brandingEnabled && !!images.logoPath && !logo,
    staleBrandGuide: brandingEnabled && images.brandGuideMode === "image" && !!images.brandGuidePath && !guide,
  };
}

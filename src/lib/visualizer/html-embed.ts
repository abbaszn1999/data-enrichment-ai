import type { VisualizerImagePlaceholder } from "@/lib/visualizer/types";

const STORAGE_SRC_PREFIX = "vz-storage:";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Replace [imageplaceholder-N] markers with img tags pointing at private storage paths. */
export function embedVisualizerPlaceholders(
  descriptionHtml: string,
  placeholders: VisualizerImagePlaceholder[]
): string {
  let html = descriptionHtml;
  for (const item of placeholders) {
    if (!item.storagePath) continue;
    const figure = `<figure style="margin:0"><img src="${STORAGE_SRC_PREFIX}${item.storagePath}" alt="${escapeAttr(item.alt || `Product visual ${item.index}`)}" style="display:block;width:100%;height:auto;border-radius:8px;object-fit:cover" /></figure>`;
    html = html.split(`[imageplaceholder-${item.index}]`).join(figure);
  }
  return html;
}

/** Swap vz-storage: paths for signed (or public) URLs for preview/export. */
export function resolveVisualizerHtmlImages(
  descriptionHtml: string,
  signedUrls: Record<string, string>
): string {
  return descriptionHtml.replace(
    /src="vz-storage:([^"]+)"/g,
    (full, path: string) => {
      const url = signedUrls[path];
      return url ? `src="${escapeAttr(url)}"` : full;
    }
  );
}

export function collectVisualizerImagePaths(
  placeholders: VisualizerImagePlaceholder[] | undefined
): string[] {
  if (!placeholders?.length) return [];
  return placeholders
    .map((item) => item.storagePath)
    .filter((path): path is string => !!path && !/^https?:\/\//i.test(path));
}

export { STORAGE_SRC_PREFIX };

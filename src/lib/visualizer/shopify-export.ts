import { createHash } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase-admin";
import { mapLimit } from "@/lib/async/map-limit";
import { collectVisualizerImagePaths } from "@/lib/visualizer/html-embed";
import { getVisualizerPrefix } from "@/lib/visualizer/storage-paths";
import type { VisualizerRow } from "@/lib/visualizer/types";
import type { TableExport } from "@/lib/export/table-file";
import { PLATFORM_IMAGE_LINK_TTL_SEC } from "@/lib/export/table-platform";

const BUCKET = "workspace-files";
export const DESCRIPTION_IMAGES_HEADER = "Description images";

/**
 * Shopify keeps the file name of every picture it downloads. Each description
 * picture is copied to a name made from its storage path (stable, so a second
 * export reuses it) and signed for the import; the description then points at
 * the CDN link Shopify will give that file.
 */
export async function prepareShopifyDescriptionImages(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  sessionId: string;
  rows: VisualizerRow[];
  /** Store CDN folder, e.g. https://cdn.shopify.com/s/files/1/0832/7305/6474/files/ */
  filesPrefix: string;
}): Promise<{ cdnByPath: Record<string, string>; signedByPath: Record<string, string> }> {
  const { admin, workspaceId, sessionId, rows, filesPrefix } = params;
  const paths = [...new Set(rows.flatMap((row) => collectVisualizerImagePaths(row.imagePlaceholders)))];
  const folder = `${getVisualizerPrefix(workspaceId, sessionId)}/exports/shopify`;
  const cdnByPath: Record<string, string> = {};
  const signedByPath: Record<string, string> = {};

  await mapLimit(paths, 8, async (path) => {
    const ext = path.match(/\.(jpe?g|png|webp|gif)$/i)?.[1]?.toLowerCase() ?? "jpg";
    const name = `vz-${createHash("sha256").update(path).digest("hex").slice(0, 20)}.${ext}`;
    const copyTo = `${folder}/${name}`;
    const copied = await admin.storage.from(BUCKET).copy(path, copyTo);
    // "already exists" means an earlier export made this copy; it can be reused.
    if (copied.error && !/exist/i.test(copied.error.message)) return path;
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(copyTo, PLATFORM_IMAGE_LINK_TTL_SEC);
    if (!data?.signedUrl) return path;
    signedByPath[path] = data.signedUrl;
    cdnByPath[path] = filesPrefix + name;
    return path;
  });
  return { cdnByPath, signedByPath };
}

/** Adds one column listing each row's description pictures (signed links, in placeholder order). */
export function withDescriptionImagesColumn(
  table: TableExport,
  rows: VisualizerRow[],
  signedByPath: Record<string, string>
): TableExport {
  return {
    ...table,
    headers: [...table.headers, DESCRIPTION_IMAGES_HEADER],
    rows: table.rows.map((values, index) => {
      const placeholders = [...(rows[index]?.imagePlaceholders ?? [])].sort((a, b) => a.index - b.index);
      const links = placeholders
        .map((item) => (item.storagePath ? signedByPath[item.storagePath] : undefined))
        .filter((link): link is string => Boolean(link));
      return [...values, links.join("\n")];
    }),
  };
}

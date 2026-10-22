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

/** File name Shopify will keep for a picture: made from its storage path, so it is stable and unique. */
export function shopifyFileName(path: string): string {
  const ext = path.match(/\.(jpe?g|png|webp|gif)$/i)?.[1]?.toLowerCase() ?? "jpg";
  return `vz-${createHash("sha256").update(path).digest("hex").slice(0, 20)}.${ext}`;
}

function descriptionImagePaths(rows: VisualizerRow[]): string[] {
  return [...new Set(rows.flatMap((row) => collectVisualizerImagePaths(row.imagePlaceholders)))];
}

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
  const paths = descriptionImagePaths(rows);
  const folder = `${getVisualizerPrefix(workspaceId, sessionId)}/exports/shopify`;
  const cdnByPath: Record<string, string> = {};
  const signedByPath: Record<string, string> = {};

  await mapLimit(paths, 8, async (path) => {
    const name = shopifyFileName(path);
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

const FILES_README = `How to import into Shopify

1. In Shopify admin, open Content > Files and click Upload files.
   Select every picture in the "images" folder (keep the file names).
2. Wait until all pictures show in Files.
3. Open Products > Import, choose shopify-products.csv and tick
   "Overwrite products with matching handles".

The descriptions already point at these pictures in your store, so they
show once both steps are done. Product images are not changed.
`;

/**
 * ZIP for the "Shopify Files" route: the description CSV, every description
 * picture under the name the descriptions point at, and the steps to follow.
 */
export async function buildShopifyFilesZip(params: {
  admin: ReturnType<typeof createAdminClient>;
  rows: VisualizerRow[];
  csv: string;
}): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("shopify-products.csv", params.csv);
  zip.file("README.txt", FILES_README);
  const folder = zip.folder("images")!;
  await mapLimit(descriptionImagePaths(params.rows), 8, async (path) => {
    const { data } = await params.admin.storage.from(BUCKET).download(path);
    if (data) folder.file(shopifyFileName(path), Buffer.from(await data.arrayBuffer()));
    return path;
  });
  // Pictures are already compressed; storing them keeps the export fast.
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

/** CDN link for every description picture, for descriptions whose pictures go to Shopify Files. */
export function shopifyFilesLinks(rows: VisualizerRow[], filesPrefix: string): Record<string, string> {
  return Object.fromEntries(descriptionImagePaths(rows).map((path) => [path, filesPrefix + shopifyFileName(path)]));
}

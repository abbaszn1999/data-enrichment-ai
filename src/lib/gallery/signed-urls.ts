import type { GalleryWorksheetJson } from "@/lib/gallery/types";
import { createSignedUrlsAdmin } from "@/lib/gallery/storage-admin";

export function collectGalleryImagePaths(worksheet: GalleryWorksheetJson): string[] {
  const paths = new Set<string>();
  const addStoragePath = (path: string | null | undefined) => {
    if (path && !/^https?:\/\//i.test(path)) paths.add(path);
  };
  const ai = worksheet.settings.ai;
  addStoragePath(ai.logoPath);
  addStoragePath(ai.brandGuidePath);
  addStoragePath(ai.sceneReferencePath);
  for (const row of worksheet.rows) {
    const mainPaths = row.mainImagePaths?.length
      ? row.mainImagePaths
      : row.mainImagePath
        ? [row.mainImagePath]
        : [];
    for (const path of mainPaths) addStoragePath(path);
    for (const path of row.galleryImagePaths) addStoragePath(path);
  }
  return [...paths];
}

export async function signGalleryWorksheetImages(
  worksheet: GalleryWorksheetJson,
  expiresInSec = 3600
): Promise<Record<string, string>> {
  return createSignedUrlsAdmin(collectGalleryImagePaths(worksheet), expiresInSec);
}

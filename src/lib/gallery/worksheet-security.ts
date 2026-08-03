import {
  getGalleryAiAssetsFolder,
  getGalleryPrefix,
} from "@/lib/gallery/storage-paths";
import {
  getRowMainImagePaths,
  type GalleryProjectSettings,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";

/**
 * Reject client-supplied private Storage paths outside this project.
 * External http(s) source URLs are intentionally allowed for scraped Gallery.
 */
export function worksheetImageRefsBelongToSession(
  worksheet: GalleryWorksheetJson,
  workspaceId: string,
  sessionId: string
): boolean {
  const rowsPrefix = `${getGalleryPrefix(workspaceId, sessionId)}/rows/`;
  const isAllowed = (value: string) =>
    /^https?:\/\//i.test(value) || value.startsWith(rowsPrefix);

  return worksheet.rows.every((row) =>
    [...getRowMainImagePaths(row), ...row.galleryImagePaths].every(isAllowed)
  );
}

export function galleryReferencePathsBelongToSession(
  settings: GalleryProjectSettings,
  workspaceId: string,
  sessionId: string
): boolean {
  const prefix = `${getGalleryAiAssetsFolder(workspaceId, sessionId)}/`;
  return [
    settings.ai.logoPath,
    settings.ai.brandGuidePath,
    settings.ai.sceneReferencePath,
  ].every((path) => path === null || path.startsWith(prefix));
}

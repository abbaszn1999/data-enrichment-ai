import {
  listGalleryFolderAdmin,
} from "@/lib/gallery/storage-admin";
import {
  getGalleryAiAssetsFolder,
  getGalleryAiAssetsLegacyFolder,
  getGalleryPrefix,
} from "@/lib/gallery/storage-paths";
import type { GalleryWorksheetJson } from "@/lib/gallery/types";

const ASSET_FILE_PREFIX: Record<
  "logoPath" | "brandGuidePath" | "sceneReferencePath",
  string
> = {
  logoPath: "logo.",
  brandGuidePath: "brand-guide.",
  sceneReferencePath: "scene-reference.",
};

/**
 * Recover AI reference paths after a stale worksheet read. Rapid upload→PATCH
 * races can load a worksheet snapshot from before the asset path was written,
 * then save and wipe sceneReferencePath / logoPath / brandGuidePath while the
 * file remains in Storage.
 *
 * Also clears paths that point at files the user already deleted from Storage,
 * so Generate does not hard-fail on a dead path.
 */
export async function reconcileGalleryAiAssetPaths(
  workspaceId: string,
  sessionId: string,
  worksheet: GalleryWorksheetJson
): Promise<GalleryWorksheetJson> {
  const folders = [
    getGalleryAiAssetsFolder(workspaceId, sessionId),
    getGalleryAiAssetsLegacyFolder(workspaceId, sessionId),
    `${getGalleryPrefix(workspaceId, sessionId)}/settings`,
  ];
  const listed: string[] = [];
  let listOk = false;
  for (const folder of folders) {
    try {
      const paths = await listGalleryFolderAdmin(folder);
      listed.push(...paths);
      listOk = true;
    } catch {
      // Keep going; other folders may still list.
    }
  }

  const ai = worksheet.settings.ai;
  for (const [setting, prefix] of Object.entries(ASSET_FILE_PREFIX) as Array<
    [keyof typeof ASSET_FILE_PREFIX, string]
  >) {
    const current = ai[setting];
    if (current && listed.includes(current)) continue;
    if (current && listOk && !listed.includes(current)) {
      // Path recorded but file is gone (user removed it) — drop the stale path.
      ai[setting] = null;
      continue;
    }
    if (current) continue;
    const match = listed.find((path) => {
      const name = path.split("/").pop() || "";
      return name.startsWith(prefix);
    });
    if (match) ai[setting] = match;
  }
  return worksheet;
}

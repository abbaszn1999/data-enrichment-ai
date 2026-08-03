import type { GalleryWorksheetJson } from "@/lib/gallery/types";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getGalleryPrefix(workspaceId: string, sessionId: string): string {
  return `${workspaceId}/gallery/${sessionId}`;
}

export function getGalleryWorksheetPath(workspaceId: string, sessionId: string): string {
  return `${getGalleryPrefix(workspaceId, sessionId)}/worksheet.json`;
}

export function getGallerySourcePath(
  workspaceId: string,
  sessionId: string,
  fileName: string
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${getGalleryPrefix(workspaceId, sessionId)}/source-${safe}`;
}

export function getGalleryRowImagePath(
  workspaceId: string,
  sessionId: string,
  rowId: string,
  kind: "main" | "gallery",
  ext: string
): string {
  const id = newId();
  const cleanExt = ext.replace(/^\./, "") || "jpg";
  if (kind === "main") {
    return `${getGalleryPrefix(workspaceId, sessionId)}/rows/${rowId}/main-${id}.${cleanExt}`;
  }
  return `${getGalleryPrefix(workspaceId, sessionId)}/rows/${rowId}/gallery/${id}.${cleanExt}`;
}

export function getGalleryAiAssetPath(
  workspaceId: string,
  sessionId: string,
  kind: "logo" | "brand-guide" | "scene-reference",
  ext: string
): string {
  // Per-session settings assets (stable path so replace overwrites, no duplicates).
  const cleanExt = ext.replace(/^\./, "").replace(/[^a-zA-Z0-9]/g, "") || "png";
  return `${getGalleryPrefix(workspaceId, sessionId)}/settings/ai-assets/${kind}.${cleanExt}`;
}

export function getGalleryAiAssetsFolder(
  workspaceId: string,
  sessionId: string
): string {
  return `${getGalleryPrefix(workspaceId, sessionId)}/settings/ai-assets`;
}

/** Legacy folder used before settings/ nesting; cleaned on upload/replace. */
export function getGalleryAiAssetsLegacyFolder(
  workspaceId: string,
  sessionId: string
): string {
  return `${getGalleryPrefix(workspaceId, sessionId)}/ai-assets`;
}

export function getGalleryExportPath(
  workspaceId: string,
  sessionId: string,
  ext: "xlsx" | "csv" = "xlsx"
): string {
  return `${getGalleryPrefix(workspaceId, sessionId)}/exports/${Date.now()}.${ext}`;
}

export type { GalleryWorksheetJson };

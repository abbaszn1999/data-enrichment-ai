function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getVisualizerPrefix(
  workspaceId: string,
  sessionId: string
): string {
  return `${workspaceId}/description-visualizer/${sessionId}`;
}

export function getVisualizerWorksheetPath(
  workspaceId: string,
  sessionId: string
): string {
  return `${getVisualizerPrefix(workspaceId, sessionId)}/worksheet.json`;
}

export function getVisualizerResultsPath(
  workspaceId: string,
  sessionId: string
): string {
  return `${getVisualizerPrefix(workspaceId, sessionId)}/results.xlsx`;
}

export function getVisualizerSourcePath(
  workspaceId: string,
  sessionId: string,
  fileName: string
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${getVisualizerPrefix(workspaceId, sessionId)}/source-${safe}`;
}

export function getVisualizerRowImagePath(
  workspaceId: string,
  sessionId: string,
  rowId: string,
  placeholderIndex: number,
  ext: string
): string {
  const id = newId();
  const cleanExt = ext.replace(/^\./, "") || "webp";
  const index = Math.max(1, Math.floor(placeholderIndex));
  return `${getVisualizerPrefix(workspaceId, sessionId)}/rows/${rowId}/image-${index}-${id}.${cleanExt}`;
}

export function getVisualizerAiAssetPath(
  workspaceId: string,
  sessionId: string,
  kind: "logo" | "brand-guide",
  ext: string
): string {
  const cleanExt = ext.replace(/^\./, "") || "jpg";
  return `${getVisualizerPrefix(workspaceId, sessionId)}/settings/ai-assets/${kind}.${cleanExt}`;
}

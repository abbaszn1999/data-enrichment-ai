import type {
  GallerySession,
  GalleryWorksheetJson,
  GalleryProvider,
  GalleryProjectSettings,
  GalleryRunPhase,
} from "@/lib/gallery/types";

export class GalleryApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
    this.name = "GalleryApiError";
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new GalleryApiError(
      String(data.message || data.error || `Request failed (${res.status})`),
      res.status,
      data
    );
  }
  return data as T;
}

export async function listGallerySessions(workspaceId: string) {
  const res = await fetch(
    `/api/gallery/sessions?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  return parseJson<{ sessions: GallerySession[] }>(res);
}

export async function createGallerySession(params: {
  workspaceId: string;
  name: string;
  file: File;
}) {
  const form = new FormData();
  form.set("workspaceId", params.workspaceId);
  form.set("name", params.name);
  form.set("file", params.file);
  const res = await fetch("/api/gallery/sessions", { method: "POST", body: form });
  return parseJson<{ session: GallerySession; worksheet: GalleryWorksheetJson }>(res);
}

export async function getGallerySession(
  workspaceId: string,
  sessionId: string,
  options?: { includeSignedUrls?: boolean }
) {
  const includeSignedUrls = options?.includeSignedUrls !== false;
  const res = await fetch(
    `/api/gallery/sessions/${sessionId}?workspaceId=${encodeURIComponent(workspaceId)}&includeSignedUrls=${includeSignedUrls ? "1" : "0"}`
  );
  return parseJson<{
    session: GallerySession;
    worksheet: GalleryWorksheetJson | null;
    signedUrls?: Record<string, string>;
  }>(res);
}

export async function patchGallerySession(params: {
  workspaceId: string;
  sessionId: string;
  revision?: number;
  name?: string;
  worksheet?: Partial<GalleryWorksheetJson>;
}) {
  const res = await fetch(`/api/gallery/sessions/${params.sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      revision: params.revision,
      name: params.name,
      worksheet: params.worksheet,
    }),
  });
  return parseJson<{ session: GallerySession; worksheet: GalleryWorksheetJson }>(res);
}

export async function saveGallerySettings(params: {
  workspaceId: string;
  sessionId: string;
  expectedRevision: number;
  expectedWorksheetRevision: number;
  settings: GalleryProjectSettings;
  worksheet: GalleryWorksheetJson;
}) {
  const res = await fetch(
    `/api/gallery/sessions/${params.sessionId}/settings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        expectedRevision: params.expectedRevision,
        expectedWorksheetRevision: params.expectedWorksheetRevision,
        settings: params.settings,
        worksheet: params.worksheet,
      }),
    }
  );
  return parseJson<{
    session: GallerySession;
    settings: GalleryProjectSettings;
    worksheet: GalleryWorksheetJson;
  }>(res);
}

export async function deleteGalleryImage(params: {
  workspaceId: string;
  sessionId: string;
  rowId: string;
  path: string;
  revision?: number;
}) {
  const res = await fetch(`/api/gallery/sessions/${params.sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      revision: params.revision,
      deleteGalleryImage: { rowId: params.rowId, path: params.path },
    }),
  });
  return parseJson<{ session: GallerySession; worksheet: GalleryWorksheetJson }>(res);
}

export async function deleteGalleryRows(params: {
  workspaceId: string;
  sessionId: string;
  rowIds: string[];
  revision?: number;
}) {
  const res = await fetch(`/api/gallery/sessions/${params.sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      revision: params.revision,
      deleteRows: { rowIds: params.rowIds },
    }),
  });
  return parseJson<{ session: GallerySession; worksheet: GalleryWorksheetJson }>(res);
}

export type GalleryAiAssetKind = "logo" | "brandGuide" | "sceneReference";

export async function uploadGalleryAiAsset(params: {
  workspaceId: string;
  sessionId: string;
  kind: GalleryAiAssetKind;
  file: File;
}) {
  const form = new FormData();
  form.set("workspaceId", params.workspaceId);
  form.set("kind", params.kind);
  form.set("file", params.file);
  const res = await fetch(
    `/api/gallery/sessions/${params.sessionId}/assets`,
    { method: "POST", body: form }
  );
  return parseJson<{
    session: GallerySession;
    settings: GalleryProjectSettings;
    signedUrls: Record<string, string>;
    path?: string | null;
  }>(res);
}

export async function deleteGalleryAiAsset(params: {
  workspaceId: string;
  sessionId: string;
  kind: GalleryAiAssetKind;
}) {
  const res = await fetch(
    `/api/gallery/sessions/${params.sessionId}/assets`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        kind: params.kind,
      }),
    }
  );
  return parseJson<{
    session: GallerySession;
    settings: GalleryProjectSettings;
    signedUrls: Record<string, string>;
  }>(res);
}

export async function deleteGallerySession(workspaceId: string, sessionId: string) {
  const res = await fetch(
    `/api/gallery/sessions/${sessionId}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: "DELETE" }
  );
  return parseJson<{ success: boolean }>(res);
}

export async function generateGallery(params: {
  workspaceId: string;
  sessionId: string;
  rowIds: string[];
  provider: GalleryProvider;
  /** Immutable configuration snapshot used by this run. */
  settingsSnapshot: GalleryProjectSettings;
  /** Immutable worksheet snapshot used by this run. */
  worksheetSnapshot: GalleryWorksheetJson;
  worksheetRevision: number;
  estimateOnly?: boolean;
  retryFailed?: boolean;
  /** Explicit UI value so generate never relies on a stale worksheet alone. */
  imagesPerRow?: number;
  /** Explicit Main count (AI + Scraping) — same idea as imagesPerRow for Gallery. */
  mainImagesPerRow?: number;
  /**
   * Explicit UI choice: column name to copy as Main, or null to generate Main.
   * Always send this so a stale worksheet cannot keep an old Images column.
   */
  originalImageColumn?: string | null;
  /**
   * Optional phase. Omit for mixed selections so the server resolves per row.
   */
  runPhase?: GalleryRunPhase;
}) {
  const res = await fetch("/api/gallery/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJson<{
    runId?: string;
    status?: string;
    completed?: number;
    failed?: number;
    usedCredits?: number;
    estimatedCredits?: number;
    estimateRange?: {
      min: number;
      max: number;
      expectedQueriesPerStage: number;
      highQueriesPerStage: number;
    } | null;
    remaining?: number;
    required?: number;
    worksheet?: GalleryWorksheetJson;
    session?: GallerySession;
    signedUrls?: Record<string, string>;
    message?: string;
    error?: string;
  }>(res);
}

export async function requestGalleryGenerationStop(params: {
  workspaceId: string;
  sessionId: string;
}) {
  const res = await fetch(
    `/api/gallery/sessions/${params.sessionId}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: params.workspaceId }),
    }
  );
  return parseJson<{ accepted: true }>(res);
}

export async function exportGallery(params: {
  workspaceId: string;
  sessionId: string;
  fileName?: string;
}) {
  const res = await fetch("/api/gallery/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new GalleryApiError(
      String(data.error || `Export failed (${res.status})`),
      res.status,
      data
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = params.fileName || "gallery_export.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

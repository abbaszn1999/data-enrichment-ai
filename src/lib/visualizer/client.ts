import type {
  VisualizerProjectSettings,
  VisualizerRow,
  VisualizerSession,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";

export class VisualizerApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
    this.name = "VisualizerApiError";
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new VisualizerApiError(
      String(data.message || data.error || `Request failed (${res.status})`),
      res.status,
      data
    );
  }
  return data as T;
}

export async function listVisualizerSessions(workspaceId: string) {
  const res = await fetch(
    `/api/visualizer/sessions?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  return parseJson<{ sessions: VisualizerSession[] }>(res);
}

export async function createVisualizerSession(params: {
  workspaceId: string;
  name: string;
  file: File;
}) {
  const form = new FormData();
  form.set("workspaceId", params.workspaceId);
  form.set("name", params.name);
  form.set("file", params.file);
  const res = await fetch("/api/visualizer/sessions", {
    method: "POST",
    body: form,
  });
  return parseJson<{
    session: VisualizerSession;
    worksheet: VisualizerWorksheetJson;
  }>(res);
}

export async function getVisualizerProgress(workspaceId: string, sessionId: string) {
  const res = await fetch(
    `/api/visualizer/sessions/${sessionId}/progress?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  return parseJson<{
    sessionId: string;
    status: VisualizerSession["status"];
    total: number;
    readyRows: number;
    failedRows: number;
    worksheetRevision: number;
    cancelRequested: boolean;
    activePhase: VisualizerSession["active_phase"];
    awaitingUserAction: boolean;
    completed: number;
    failed: number;
    jobId: string | null;
    jobStatus: string | null;
  }>(res);
}

export async function getVisualizerSession(
  workspaceId: string,
  sessionId: string,
  options?: { includeSignedUrls?: boolean }
) {
  const params = new URLSearchParams({ workspaceId });
  if (options?.includeSignedUrls) params.set("includeSignedUrls", "1");
  const res = await fetch(
    `/api/visualizer/sessions/${sessionId}?${params.toString()}`
  );
  return parseJson<{
    session: VisualizerSession;
    worksheet: VisualizerWorksheetJson | null;
    signedUrls?: Record<string, string>;
  }>(res);
}

export async function getVisualizerRowsDelta(
  workspaceId: string,
  sessionId: string,
  since: string | null,
  watchedRowIds: string[] = []
) {
  const params = new URLSearchParams({ workspaceId });
  if (since) params.set("since", since);
  if (watchedRowIds.length > 0) params.set("ids", watchedRowIds.join(","));
  const res = await fetch(
    `/api/visualizer/sessions/${sessionId}/rows?${params.toString()}`
  );
  return parseJson<{
    supported: boolean;
    rows?: VisualizerRow[];
    signedUrls?: Record<string, string>;
    cursor?: string;
    hasMore?: boolean;
  }>(res);
}

/** Signs stored image paths the preview does not have a link for yet. */
export async function signVisualizerStoragePaths(params: {
  workspaceId: string;
  sessionId: string;
  paths: string[];
}) {
  const signedUrls: Record<string, string> = {};
  const unique = [...new Set(params.paths.filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += 200) {
    const res = await fetch(
      `/api/visualizer/sessions/${params.sessionId}/signed-urls`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: params.workspaceId,
          paths: unique.slice(offset, offset + 200),
        }),
      }
    );
    const body = await parseJson<{ signedUrls: Record<string, string> }>(res);
    Object.assign(signedUrls, body.signedUrls);
  }
  return { signedUrls };
}

/** Saves project settings only; rows are never sent, so results a run wrote stay intact. */
export async function saveVisualizerSettings(params: {
  workspaceId: string;
  sessionId: string;
  expectedRevision: number;
  settings: VisualizerProjectSettings;
  keepalive?: boolean;
}) {
  const res = await fetch(
    `/api/visualizer/sessions/${params.sessionId}/settings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      keepalive: params.keepalive,
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        expectedRevision: params.expectedRevision,
        settings: params.settings,
      }),
    }
  );
  return parseJson<{
    session: VisualizerSession;
    settings: VisualizerProjectSettings;
  }>(res);
}

export async function deleteVisualizerSession(params: {
  workspaceId: string;
  sessionId: string;
}) {
  const res = await fetch(
    `/api/visualizer/sessions/${params.sessionId}?workspaceId=${encodeURIComponent(params.workspaceId)}`,
    { method: "DELETE" }
  );
  return parseJson<{ ok: true }>(res);
}

export async function generateVisualizerDescriptions(params: {
  workspaceId: string;
  sessionId: string;
  settingsSnapshot: VisualizerProjectSettings;
  worksheetSnapshot: VisualizerWorksheetJson;
  worksheetRevision: number;
  rowIds?: string[];
  estimateOnly?: boolean;
  retryFailed?: boolean;
}) {
  const res = await fetch("/api/visualizer/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...params,
      phase: "description",
    }),
  });
  return parseJson<{
    runId?: string;
    status?: string;
    phase?: string;
    completed?: number;
    failed?: number;
    usedCredits?: number;
    estimatedCredits?: number;
    estimateRange?: { min: number; max: number };
    remaining?: number;
    required?: number;
    worksheet?: VisualizerWorksheetJson;
    session?: VisualizerSession;
    signedUrls?: Record<string, string>;
    message?: string;
    error?: string;
  }>(res);
}

export async function generateVisualizerFull(params: {
  workspaceId: string;
  sessionId: string;
  settingsSnapshot: VisualizerProjectSettings;
  worksheetSnapshot: VisualizerWorksheetJson;
  worksheetRevision: number;
  rowIds?: string[];
  estimateOnly?: boolean;
  retryFailed?: boolean;
}) {
  const res = await fetch("/api/visualizer/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...params,
      phase: "full",
    }),
  });
  return parseJson<{
    runId?: string;
    status?: string;
    phase?: string;
    completed?: number;
    failed?: number;
    usedCredits?: number;
    estimatedCredits?: number;
    estimateRange?: { min: number; max: number };
    remaining?: number;
    required?: number;
    worksheet?: VisualizerWorksheetJson;
    session?: VisualizerSession;
    signedUrls?: Record<string, string>;
    message?: string;
    error?: string;
  }>(res);
}

export async function generateVisualizerImages(params: {
  workspaceId: string;
  sessionId: string;
  settingsSnapshot: VisualizerProjectSettings;
  worksheetSnapshot: VisualizerWorksheetJson;
  worksheetRevision: number;
  rowIds?: string[];
  estimateOnly?: boolean;
  retryFailed?: boolean;
}) {
  const res = await fetch("/api/visualizer/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...params,
      phase: "images",
    }),
  });
  return parseJson<{
    runId?: string;
    status?: string;
    phase?: string;
    completed?: number;
    failed?: number;
    usedCredits?: number;
    estimatedCredits?: number;
    estimateRange?: { min: number; max: number };
    remaining?: number;
    required?: number;
    worksheet?: VisualizerWorksheetJson;
    session?: VisualizerSession;
    signedUrls?: Record<string, string>;
    message?: string;
    error?: string;
  }>(res);
}

export async function requestVisualizerGenerationStop(params: {
  workspaceId: string;
  sessionId: string;
}) {
  const res = await fetch(
    `/api/visualizer/sessions/${params.sessionId}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: params.workspaceId }),
    }
  );
  return parseJson<{ accepted: true }>(res);
}

export async function uploadVisualizerAsset(params: {
  workspaceId: string;
  sessionId: string;
  kind: "logo" | "brandGuide";
  file: File;
  /** Current UI settings — persisted with the asset so layout/branding are not lost. */
  settings?: VisualizerProjectSettings;
}) {
  const form = new FormData();
  form.set("workspaceId", params.workspaceId);
  form.set("kind", params.kind);
  form.set("file", params.file);
  if (params.settings) {
    form.set("settings", JSON.stringify(params.settings));
  }
  const res = await fetch(
    `/api/visualizer/sessions/${params.sessionId}/assets`,
    { method: "POST", body: form }
  );
  return parseJson<{
    session: VisualizerSession;
    settings: VisualizerProjectSettings;
    path: string;
    signedUrls: Record<string, string>;
  }>(res);
}

export async function deleteVisualizerAsset(params: {
  workspaceId: string;
  sessionId: string;
  kind: "logo" | "brandGuide";
  settings?: VisualizerProjectSettings;
}) {
  const res = await fetch(
    `/api/visualizer/sessions/${params.sessionId}/assets`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: params.workspaceId,
        kind: params.kind,
        settings: params.settings,
      }),
    }
  );
  return parseJson<{
    session: VisualizerSession;
    settings: VisualizerProjectSettings;
  }>(res);
}

export function visualizerExportUrl(workspaceId: string, sessionId: string) {
  return `/api/visualizer/sessions/${sessionId}/export?workspaceId=${encodeURIComponent(workspaceId)}`;
}

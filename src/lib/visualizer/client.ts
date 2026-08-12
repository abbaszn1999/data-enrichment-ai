import type {
  VisualizerProjectSettings,
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

export async function saveVisualizerSettings(params: {
  workspaceId: string;
  sessionId: string;
  expectedRevision: number;
  expectedWorksheetRevision: number;
  settings: VisualizerProjectSettings;
  worksheet: VisualizerWorksheetJson;
}) {
  const res = await fetch(
    `/api/visualizer/sessions/${params.sessionId}/settings`,
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
    session: VisualizerSession;
    settings: VisualizerProjectSettings;
    worksheet: VisualizerWorksheetJson;
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

export async function exportVisualizer(params: {
  workspaceId: string;
  sessionId: string;
  fileName?: string;
}) {
  const res = await fetch(
    `/api/visualizer/sessions/${params.sessionId}/export`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: params.workspaceId }),
    }
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new VisualizerApiError(
      String(data.error || `Export failed (${res.status})`),
      res.status,
      data
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = params.fileName || "visualizer_export.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function visualizerExportUrl(workspaceId: string, sessionId: string) {
  return `/api/visualizer/sessions/${sessionId}/export?workspaceId=${encodeURIComponent(workspaceId)}`;
}

"use client";

import type { WrPhase, WrProjectRow, WrVersion } from "./types";

const BASE = "/api/website-restructure";

export type WrProjectRowWithUrls = WrProjectRow & { state: WrProjectRow["state"] & { imageUrls: Record<string, string> } };

async function asJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

export type WrProjectsResponse = {
  projects: WrProjectRowWithUrls[];
  projectLimit: number;
  projectsCreatedTotal: number;
};

export async function fetchWrProjects(workspaceId: string): Promise<WrProjectsResponse> {
  const res = await fetch(`${BASE}/state?workspaceId=${encodeURIComponent(workspaceId)}`);
  return asJson<WrProjectsResponse>(res);
}

export async function createWrProjectApi(workspaceId: string, name: string): Promise<WrProjectRow> {
  const res = await fetch(`${BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, name }),
  });
  const data = await asJson<{ project: WrProjectRow }>(res);
  return data.project;
}

export async function deleteWrProjectApi(workspaceId: string, projectId: string): Promise<void> {
  const res = await fetch(`${BASE}/projects`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId }),
  });
  await asJson(res);
}

export async function patchWrProjectApi(
  workspaceId: string,
  projectId: string,
  patch: { name?: string; status?: "active" | "completed"; phase?: WrPhase }
): Promise<WrProjectRow> {
  const res = await fetch(`${BASE}/projects`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, ...patch }),
  });
  const data = await asJson<{ project: WrProjectRow }>(res);
  return data.project;
}

export async function putWrStateApi(
  workspaceId: string,
  projectId: string,
  state: WrProjectRow["state"]
): Promise<void> {
  const res = await fetch(`${BASE}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, state }),
  });
  await asJson(res);
}

export async function fetchWrSourcesApi(workspaceId: string, projectId: string) {
  const res = await fetch(
    `${BASE}/sources?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}`
  );
  return asJson<{ ok: true; provider: string; tree: unknown; storeLinks: unknown }>(res);
}

export async function uploadWrAssetApi(input: {
  workspaceId: string;
  projectId: string;
  kind: "image" | "logo";
  filename: string;
  mimeType: string;
  dataBase64: string;
}) {
  const res = await fetch(`${BASE}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson<{ ok: true; asset: { id: string; storagePath: string; filename: string }; url: string | null }>(res);
}

export async function deleteWrAssetApi(input: {
  workspaceId: string;
  projectId: string;
  kind: "image" | "logo";
  imageId?: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/assets`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await asJson(res);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export type WrStreamEvent =
  | { type: "status"; message: string }
  | { type: "version"; data: WrVersion; logoUrl: string | null; editMessagesUsed?: number }
  | { type: "error"; error: string };

async function readNdjsonStream(res: Response, onEvent: (event: WrStreamEvent) => void): Promise<void> {
  if (!res.body) throw new Error("Streaming is not supported in this browser");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onEvent(JSON.parse(trimmed) as WrStreamEvent);
      } catch {
        // Ignore malformed lines rather than aborting the whole stream.
      }
    }
  }
  const trimmed = buffer.trim();
  if (trimmed) {
    try {
      onEvent(JSON.parse(trimmed) as WrStreamEvent);
    } catch {
      // ignore
    }
  }
}

export async function runWrBuildApi(
  input: { workspaceId: string; projectId: string; storeLanguageHint?: string },
  onEvent: (event: WrStreamEvent) => void
): Promise<void> {
  const res = await fetch(`${BASE}/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  // A non-2xx response here is always a plain JSON error (invalid payload,
  // no lease, wrong phase, etc.) — the NDJSON stream only ever starts once
  // the route has committed to a 200. Parsing it as NDJSON would silently
  // swallow the failure, since `{ error }` doesn't match any WrStreamEvent.
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Build failed (${res.status})`);
  }
  await readNdjsonStream(res, onEvent);
}

export async function runWrEditApi(
  input: { workspaceId: string; projectId: string; instruction: string },
  onEvent: (event: WrStreamEvent) => void
): Promise<void> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  // See runWrBuildApi — a non-2xx response is a plain JSON error, never NDJSON.
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Edit failed (${res.status})`);
  }
  await readNdjsonStream(res, onEvent);
}

export async function fetchWrVersionsApi(workspaceId: string, projectId: string) {
  const res = await fetch(
    `${BASE}/versions?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}`
  );
  return asJson<{ versions: Array<{ version: number; createdAt: string; notes: string; instruction?: string }> }>(res);
}

export async function fetchWrVersionApi(workspaceId: string, projectId: string, version: number) {
  const res = await fetch(
    `${BASE}/versions?workspaceId=${encodeURIComponent(workspaceId)}&projectId=${encodeURIComponent(projectId)}&version=${version}`
  );
  return asJson<{ version: WrVersion; logoUrl: string | null }>(res);
}

export async function restoreWrVersionApi(
  workspaceId: string,
  projectId: string,
  version: number
): Promise<void> {
  const res = await fetch(`${BASE}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, projectId, version }),
  });
  await asJson(res);
}

export function wrDownloadUrl(workspaceId: string, projectId: string, version?: number): string {
  const params = new URLSearchParams({ workspaceId, projectId });
  if (version) params.set("version", String(version));
  return `${BASE}/download?${params.toString()}`;
}

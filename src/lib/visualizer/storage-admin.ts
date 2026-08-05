import { createAdminClient } from "@/lib/supabase-admin";
import {
  getVisualizerPrefix,
  getVisualizerResultsPath,
  getVisualizerWorksheetPath,
} from "@/lib/visualizer/storage-paths";
import {
  normalizeVisualizerWorksheet,
  type VisualizerWorksheetJson,
} from "@/lib/visualizer/types";
import { visualizerError, visualizerWarn } from "@/lib/visualizer/log";
import { buildVisualizerResultsBuffer } from "@/lib/visualizer/results-xlsx";
import {
  collectVisualizerImagePaths,
  resolveVisualizerHtmlImages,
} from "@/lib/visualizer/html-embed";

const BUCKET = "workspace-files";
const STORAGE_RETRIES = 5;

function storageErrorText(error: unknown): string {
  if (!(error instanceof Error)) return JSON.stringify(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText =
    cause instanceof Error
      ? `${cause.message} ${cause.cause ?? ""}`
      : cause
        ? String(cause)
        : "";
  return `${error.name} ${error.message} ${causeText}`.trim();
}

function isTransientStorageError(error: unknown): boolean {
  return /fetch failed|timeout|network|econnreset|enotfound|socket|undici|503|502|504|ECONNREFUSED|ETIMEDOUT/i.test(
    storageErrorText(error)
  );
}

async function withStorageRetry<T>(
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= STORAGE_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientStorageError(error) || attempt === STORAGE_RETRIES) break;
      const delay = 500 * 2 ** (attempt - 1);
      visualizerWarn("storage:retry", `${label} failed; retrying`, {
        attempt,
        delay,
        error: storageErrorText(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  visualizerError("storage", `${label} failed after retries`, {
    message: storageErrorText(lastError),
    stack: lastError instanceof Error ? lastError.stack : undefined,
  });
  throw lastError;
}

export async function loadVisualizerWorksheetAdmin(
  workspaceId: string,
  sessionId: string
): Promise<VisualizerWorksheetJson | null> {
  return withStorageRetry("load worksheet", async () => {
    const admin = createAdminClient();
    const path = getVisualizerWorksheetPath(workspaceId, sessionId);
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error) {
      const message = error.message || "";
      if (/not found|object not found/i.test(message)) return null;
      throw error;
    }
    if (!data) return null;
    const text = await data.text();
    return normalizeVisualizerWorksheet(
      JSON.parse(text) as VisualizerWorksheetJson
    );
  });
}

export async function loadVisualizerWorksheetMatchingRevisionAdmin(
  workspaceId: string,
  sessionId: string,
  expectedRevision: number,
  attempts = 10
): Promise<VisualizerWorksheetJson | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const worksheet = await loadVisualizerWorksheetAdmin(workspaceId, sessionId);
    if (worksheet) {
      const fileRev = worksheet.revision;
      if (typeof fileRev === "number") {
        if (fileRev >= expectedRevision) return worksheet;
      } else if (expectedRevision <= 0) {
        return worksheet;
      }
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * 2 ** Math.min(attempt, 4))
      );
    }
  }
  return null;
}

export async function saveVisualizerWorksheetAdmin(
  workspaceId: string,
  sessionId: string,
  worksheet: VisualizerWorksheetJson,
  revision?: number
): Promise<string> {
  const path = getVisualizerWorksheetPath(workspaceId, sessionId);
  const normalized = normalizeVisualizerWorksheet(worksheet);
  if (typeof revision === "number") {
    normalized.revision = revision;
  }
  return withStorageRetry("save worksheet", async () => {
    const admin = createAdminClient();
    const blob = new Blob([JSON.stringify(normalized)], {
      type: "application/octet-stream",
    });
    const { error } = await admin.storage.from(BUCKET).upload(path, blob, {
      cacheControl: "0",
      upsert: true,
      contentType: "application/json",
    });
    if (error) throw error;
    return path;
  });
}

export async function saveVisualizerResultsAdmin(
  workspaceId: string,
  sessionId: string,
  worksheet: VisualizerWorksheetJson,
  signedUrls: Record<string, string> = {}
): Promise<string> {
  const path = getVisualizerResultsPath(workspaceId, sessionId);
  const resolved: VisualizerWorksheetJson = {
    ...worksheet,
    rows: worksheet.rows.map((row) => ({
      ...row,
      generatedDescription: row.generatedDescription
        ? resolveVisualizerHtmlImages(row.generatedDescription, signedUrls)
        : row.generatedDescription,
    })),
  };
  const buffer = await buildVisualizerResultsBuffer(resolved, signedUrls);
  return withStorageRetry("save results.xlsx", async () => {
    const admin = createAdminClient();
    const { error } = await admin.storage.from(BUCKET).upload(path, buffer, {
      cacheControl: "0",
      upsert: true,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    if (error) throw error;
    return path;
  });
}

export async function uploadVisualizerBytesAdmin(
  path: string,
  buffer: Buffer,
  contentType: string,
  options?: { upsert?: boolean }
): Promise<void> {
  await withStorageRetry("upload visualizer file", async () => {
    const admin = createAdminClient();
    const { error } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      cacheControl: "3600",
      upsert: options?.upsert ?? false,
    });
    if (error) throw error;
  });
}

export async function downloadVisualizerBytesAdmin(
  path: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  return withStorageRetry("download visualizer asset", async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error) {
      if (/not found|object not found/i.test(error.message || "")) return null;
      throw error;
    }
    if (!data) return null;
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || "application/octet-stream",
    };
  });
}

export async function createVisualizerSignedUrlsAdmin(
  paths: string[],
  expiresInSec = 3600
): Promise<Record<string, string>> {
  const unique = Array.from(
    new Set(paths.filter((path) => !!path && !/^https?:\/\//i.test(path)))
  );
  if (unique.length === 0) return {};

  const CHUNK = 40;
  const map: Record<string, string> = {};

  for (let offset = 0; offset < unique.length; offset += CHUNK) {
    const chunk = unique.slice(offset, offset + CHUNK);
    const partial = await withStorageRetry(
      `create visualizer signed URLs (${offset + 1}-${offset + chunk.length}/${unique.length})`,
      async () => {
        const admin = createAdminClient();
        const { data, error } = await admin.storage
          .from(BUCKET)
          .createSignedUrls(chunk, expiresInSec);
        if (error) throw error;
        const next: Record<string, string> = {};
        for (const item of data ?? []) {
          if (item.path && item.signedUrl) next[item.path] = item.signedUrl;
          if (item.error) {
            visualizerWarn("storage", "Signed URL item error", {
              path: item.path,
              error: item.error,
            });
          }
        }
        return next;
      }
    );
    Object.assign(map, partial);
  }

  return map;
}

export function collectAllVisualizerImagePaths(
  worksheet: VisualizerWorksheetJson
): string[] {
  const paths = new Set<string>();
  for (const row of worksheet.rows) {
    for (const path of collectVisualizerImagePaths(row.imagePlaceholders)) {
      paths.add(path);
    }
  }
  const images = worksheet.settings.images;
  for (const path of [images.logoPath, images.brandGuidePath]) {
    if (path && !/^https?:\/\//i.test(path)) paths.add(path);
  }
  return [...paths];
}

export async function signVisualizerWorksheetImages(
  worksheet: VisualizerWorksheetJson,
  expiresInSec = 3600
): Promise<Record<string, string>> {
  return createVisualizerSignedUrlsAdmin(
    collectAllVisualizerImagePaths(worksheet),
    expiresInSec
  );
}

export async function removeVisualizerPathsAdmin(
  paths: string[]
): Promise<void> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return;
  await withStorageRetry("remove paths", async () => {
    const admin = createAdminClient();
    const { error } = await admin.storage.from(BUCKET).remove(unique);
    if (error) throw error;
  });
}

export async function removeVisualizerPrefixAdmin(
  workspaceId: string,
  sessionId: string
): Promise<void> {
  const admin = createAdminClient();
  const prefix = getVisualizerPrefix(workspaceId, sessionId);

  async function removeFolder(folder: string) {
    const entries: Array<{ name: string; id?: string | null }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(BUCKET).list(folder, {
        limit: 1000,
        offset,
      });
      if (error) {
        if (/not found|object not found/i.test(error.message || "")) return;
        throw error;
      }
      const batch = data ?? [];
      entries.push(...batch);
      if (batch.length < 1000) break;
    }

    const files = entries
      .filter((entry) => entry.id)
      .map((entry) => `${folder}/${entry.name}`);
    const folders = entries
      .filter((entry) => !entry.id && entry.name)
      .map((entry) => `${folder}/${entry.name}`);

    for (const child of folders) {
      await removeFolder(child);
    }
    if (files.length > 0) {
      const { error } = await admin.storage.from(BUCKET).remove(files);
      if (error && !/not found|object not found/i.test(error.message || "")) {
        throw error;
      }
    }
  }

  await withStorageRetry("remove prefix", async () => {
    await removeFolder(prefix);
  });
}

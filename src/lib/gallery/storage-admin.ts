import { createAdminClient } from "@/lib/supabase-admin";
import {
  getGalleryWorksheetPath,
  getGalleryPrefix,
} from "@/lib/gallery/storage-paths";
import {
  normalizeGalleryWorksheet,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";
import { galleryError, galleryWarn } from "@/lib/gallery/log";

const BUCKET = "workspace-files";
const STORAGE_RETRIES = 3;

/**
 * Storage GET requests are served through a CDN that can hand back a copy that
 * predates the write we just made. The generation worker reads → mutates →
 * writes this worksheet on every row, so a stale read silently resurrects old
 * rows and erases progress that was just persisted. A unique query string per
 * request forces a cache miss.
 */
async function downloadFresh(path: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${url}/storage/v1/object/${BUCKET}/${encoded}?cb=${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
    {
      cache: "no-store",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Cache-Control": "no-cache",
      },
    }
  );
  if (response.status === 404 || response.status === 400) return "";
  if (!response.ok) {
    throw new Error(`Storage download failed (${response.status})`);
  }
  return response.text();
}

function isTransientStorageError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${(error as Error & { cause?: unknown }).cause ?? ""}`
      : JSON.stringify(error);
  return /fetch failed|timeout|network|econnreset|enotfound|socket|503|502|504/i.test(
    text
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
      galleryWarn("storage:retry", `${label} failed; retrying`, {
        attempt,
        delay,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  galleryError("storage", `${label} failed after retries`, lastError);
  throw lastError;
}

export async function loadGalleryWorksheetAdmin(
  workspaceId: string,
  sessionId: string
): Promise<GalleryWorksheetJson | null> {
  return withStorageRetry("load worksheet", async () => {
    const path = getGalleryWorksheetPath(workspaceId, sessionId);
    const fresh = await downloadFresh(path);
    if (fresh !== null) {
      return fresh === ""
        ? null
        : normalizeGalleryWorksheet(JSON.parse(fresh) as GalleryWorksheetJson);
    }
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error) {
      const message = error.message || "";
      if (/not found|object not found/i.test(message)) return null;
      throw error;
    }
    if (!data) return null;
    const text = await data.text();
    return normalizeGalleryWorksheet(
      JSON.parse(text) as GalleryWorksheetJson
    );
  });
}

export async function loadGalleryWorksheetConsistentAdmin(
  workspaceId: string,
  sessionId: string,
  expectedRowCount: number,
  attempts = 5
): Promise<GalleryWorksheetJson | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const worksheet = await loadGalleryWorksheetAdmin(workspaceId, sessionId);
    if (worksheet && worksheet.rows.length === expectedRowCount) {
      return worksheet;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, 200 * 2 ** attempt)
      );
    }
  }
  return null;
}

/**
 * Reload until Storage catches up to the DB revision (or a newer one).
 * Prevents read-modify-write races where a stale worksheet.json overwrites
 * a newer delete/settings write.
 */
export async function loadGalleryWorksheetMatchingRevisionAdmin(
  workspaceId: string,
  sessionId: string,
  expectedRevision: number,
  attempts = 10
): Promise<GalleryWorksheetJson | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const worksheet = await loadGalleryWorksheetAdmin(workspaceId, sessionId);
    if (worksheet) {
      const fileRev = worksheet.revision;
      if (typeof fileRev === "number") {
        if (fileRev >= expectedRevision) return worksheet;
      } else if (expectedRevision <= 0) {
        // Only an untouched legacy session (revision zero) may lack a stamp.
        // Once DB has advanced, accepting it would let a stale worksheet revive
        // a deleted image during a later read-modify-write operation.
        return worksheet;
      }
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, 100 * 2 ** Math.min(attempt, 4))
      );
    }
  }
  // Never return a known-stale worksheet. Callers translate this to a retryable
  // synchronization response rather than persisting stale row data.
  return null;
}

export async function saveGalleryWorksheetAdmin(
  workspaceId: string,
  sessionId: string,
  worksheet: GalleryWorksheetJson,
  revision?: number
): Promise<string> {
  const path = getGalleryWorksheetPath(workspaceId, sessionId);
  const normalized = normalizeGalleryWorksheet(worksheet);
  if (typeof revision === "number") {
    normalized.revision = revision;
  }
  // Project settings live in gallery_sessions.settings. Keep Storage focused on
  // operational worksheet rows/results so settings saves cannot overwrite images.
  const { settings: _settings, ...persistedWorksheet } = normalized;
  void _settings;
  return withStorageRetry("save worksheet", async () => {
    const admin = createAdminClient();
    const blob = new Blob([JSON.stringify(persistedWorksheet)], {
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

export async function uploadGalleryBytesAdmin(
  path: string,
  buffer: Buffer,
  contentType: string,
  options?: { upsert?: boolean }
): Promise<void> {
  await withStorageRetry("upload gallery file", async () => {
    const admin = createAdminClient();
    const { error } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      cacheControl: "3600",
      upsert: options?.upsert ?? false,
    });
    if (error) throw error;
  });
}

export async function listGalleryFolderAdmin(
  folder: string
): Promise<string[]> {
  return withStorageRetry("list gallery folder", async () => {
    const admin = createAdminClient();
    const paths: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(BUCKET).list(folder, {
        limit: 1000,
        offset,
      });
      if (error) throw error;
      const batch = data ?? [];
      for (const entry of batch) {
        if (entry.name) paths.push(`${folder}/${entry.name}`);
      }
      if (batch.length < 1000) break;
    }
    return paths;
  });
}

export async function downloadGalleryBytesAdmin(
  path: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  return withStorageRetry("download gallery asset", async () => {
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

export async function createSignedUrlsAdmin(
  paths: string[],
  expiresInSec = 3600
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  return withStorageRetry("create signed URLs", async () => {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrls(paths, expiresInSec);
    if (error) throw error;
    const map: Record<string, string> = {};
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
    }
    return map;
  });
}

export async function removeGalleryPathsAdmin(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await withStorageRetry("remove gallery files", async () => {
    const admin = createAdminClient();
    const { error } = await admin.storage.from(BUCKET).remove(paths);
    if (error) throw error;
  });
}

export async function removeGalleryPrefixAdmin(
  workspaceId: string,
  sessionId: string
): Promise<void> {
  const admin = createAdminClient();
  const prefix = getGalleryPrefix(workspaceId, sessionId);

  async function removeFolder(folder: string) {
    const entries: Array<{ name: string; id?: string | null }> = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(BUCKET).list(folder, {
        limit: 1000,
        offset,
      });
      if (error) throw error;
      entries.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (!entries?.length) return;
    const files: string[] = [];
    for (const entry of entries) {
      const full = `${folder}/${entry.name}`;
      if (entry.id === null) {
        await removeFolder(full);
      } else {
        files.push(full);
      }
    }
    if (files.length) {
      const { error } = await admin.storage.from(BUCKET).remove(files);
      if (error) throw error;
    }
  }

  await removeFolder(prefix);
}

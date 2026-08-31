import type { SupabaseClient } from "@supabase/supabase-js";
import type { WrDesignBrief, WrTaxonomyTree, WrVersion } from "./types";

export const WR_STORAGE_BUCKET = "workspace-files";

export function wrProjectPath(workspaceId: string, projectId: string): string {
  return `${workspaceId}/website-restructure/${projectId}`;
}

export function wrImagesPrefix(workspaceId: string, projectId: string): string {
  return `${wrProjectPath(workspaceId, projectId)}/images`;
}

export function wrImagePath(
  workspaceId: string,
  projectId: string,
  imageId: string,
  ext: string
): string {
  return `${wrImagesPrefix(workspaceId, projectId)}/${imageId}.${ext.replace(/[^a-z0-9]/gi, "") || "jpg"}`;
}

export function wrLogoPath(workspaceId: string, projectId: string, ext: string): string {
  return `${wrProjectPath(workspaceId, projectId)}/logo.${ext.replace(/[^a-z0-9]/gi, "") || "png"}`;
}

export function wrChatAttachmentsPrefix(workspaceId: string, projectId: string): string {
  return `${wrProjectPath(workspaceId, projectId)}/chat`;
}

export function wrChatAttachmentPath(
  workspaceId: string,
  projectId: string,
  imageId: string,
  ext: string
): string {
  return `${wrChatAttachmentsPrefix(workspaceId, projectId)}/${imageId}.${ext.replace(/[^a-z0-9]/gi, "") || "png"}`;
}

/** True when `storagePath` is a chat attachment that belongs to this project. */
export function isWrChatAttachmentPath(
  workspaceId: string,
  projectId: string,
  storagePath: string
): boolean {
  const prefix = `${wrChatAttachmentsPrefix(workspaceId, projectId)}/`;
  if (!storagePath.startsWith(prefix)) return false;
  if (storagePath.includes("..") || storagePath.includes("\\")) return false;
  const rest = storagePath.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/");
}

export async function downloadWrImageAsInline(
  admin: SupabaseClient,
  storagePath: string
): Promise<{ mimeType: string; data: string } | null> {
  const { data, error } = await admin.storage.from(WR_STORAGE_BUCKET).download(storagePath);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return { mimeType: data.type || "image/jpeg", data: Buffer.from(buf).toString("base64") };
}

export function wrBriefPath(workspaceId: string, projectId: string): string {
  return `${wrProjectPath(workspaceId, projectId)}/brief.json`;
}

export function wrTaxonomyPath(workspaceId: string, projectId: string): string {
  return `${wrProjectPath(workspaceId, projectId)}/taxonomy.json`;
}

export function wrCompetitorsPath(workspaceId: string, projectId: string): string {
  return `${wrProjectPath(workspaceId, projectId)}/competitors.json`;
}

export function wrVersionsPrefix(workspaceId: string, projectId: string): string {
  return `${wrProjectPath(workspaceId, projectId)}/versions`;
}

export function wrVersionPath(
  workspaceId: string,
  projectId: string,
  version: number
): string {
  return `${wrVersionsPrefix(workspaceId, projectId)}/${version}.json`;
}

export async function saveWrJsonAdmin(
  admin: SupabaseClient,
  path: string,
  payload: unknown
): Promise<void> {
  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/octet-stream",
  });
  const { error } = await admin.storage
    .from(WR_STORAGE_BUCKET)
    .upload(path, blob, { cacheControl: "0", upsert: true });
  if (error) throw error;
}

export async function loadWrJsonAdmin<T>(
  admin: SupabaseClient,
  path: string
): Promise<T | null> {
  const { data, error } = await admin.storage.from(WR_STORAGE_BUCKET).download(path);
  if (error) {
    const message = error.message || "";
    if (/not found|object not found/i.test(message)) return null;
    throw error;
  }
  if (!data) return null;
  return JSON.parse(await data.text()) as T;
}

export async function saveWrBriefAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  brief: WrDesignBrief
): Promise<void> {
  await saveWrJsonAdmin(admin, wrBriefPath(workspaceId, projectId), brief);
}

export async function loadWrBriefAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<WrDesignBrief | null> {
  return loadWrJsonAdmin<WrDesignBrief>(admin, wrBriefPath(workspaceId, projectId));
}

export async function saveWrTaxonomyAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  tree: WrTaxonomyTree
): Promise<void> {
  await saveWrJsonAdmin(admin, wrTaxonomyPath(workspaceId, projectId), tree);
}

export async function loadWrTaxonomyAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<WrTaxonomyTree | null> {
  return loadWrJsonAdmin<WrTaxonomyTree>(admin, wrTaxonomyPath(workspaceId, projectId));
}

export async function saveWrVersionAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  version: WrVersion
): Promise<void> {
  await saveWrJsonAdmin(admin, wrVersionPath(workspaceId, projectId, version.version), version);
}

export async function loadWrVersionAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  version: number
): Promise<WrVersion | null> {
  return loadWrJsonAdmin<WrVersion>(admin, wrVersionPath(workspaceId, projectId, version));
}

/** Every version's metadata (not the code), newest first, for the rollback picker. */
export async function listWrVersionsAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<Array<{ version: number; createdAt: string; notes: string; instruction?: string }>> {
  const prefix = wrVersionsPrefix(workspaceId, projectId);
  const { data, error } = await admin.storage
    .from(WR_STORAGE_BUCKET)
    .list(prefix, { limit: 100 });
  if (error || !data) return [];

  const versionNumbers = data
    .map((item) => Number(item.name.replace(/\.json$/i, "")))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => b - a);

  const loaded = await Promise.all(
    versionNumbers.map((v) => loadWrVersionAdmin(admin, workspaceId, projectId, v))
  );
  return loaded
    .filter((v): v is WrVersion => v !== null)
    .map((v) => ({
      version: v.version,
      createdAt: v.createdAt,
      notes: v.notes,
      instruction: v.instruction,
    }));
}

const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

async function listWrFilePathsAdmin(
  admin: SupabaseClient,
  prefix: string
): Promise<string[]> {
  const files: string[] = [];
  const pending: string[] = [prefix];

  while (pending.length > 0) {
    const folder = pending.pop()!;
    let offset = 0;
    for (;;) {
      const { data, error } = await admin.storage
        .from(WR_STORAGE_BUCKET)
        .list(folder, { limit: LIST_PAGE_SIZE, offset });
      if (error || !data || data.length === 0) break;
      for (const item of data) {
        const path = `${folder}/${item.name}`;
        if (item.id) files.push(path);
        else pending.push(path);
      }
      if (data.length < LIST_PAGE_SIZE) break;
      offset += data.length;
    }
  }

  return files;
}

export async function deleteWrProjectStorageFolder(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<number> {
  const prefix = wrProjectPath(workspaceId, projectId);
  try {
    const paths = await listWrFilePathsAdmin(admin, prefix);
    let removed = 0;
    for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
      const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
      const { error } = await admin.storage.from(WR_STORAGE_BUCKET).remove(batch);
      if (error) {
        console.error("[deleteWrProjectStorageFolder] Failed to remove batch:", error);
        continue;
      }
      removed += batch.length;
    }
    return removed;
  } catch (err) {
    console.error("[deleteWrProjectStorageFolder] Error cleaning storage folder:", err);
    return 0;
  }
}

export type WrGenerationContext = {
  brief: WrDesignBrief;
  competitorNotes: Array<{ input: string; resolvedName: string; summary: string }>;
};

export async function saveWrGenerationContextAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string,
  ctx: WrGenerationContext
): Promise<void> {
  await Promise.all([
    saveWrBriefAdmin(admin, workspaceId, projectId, ctx.brief),
    saveWrJsonAdmin(admin, wrCompetitorsPath(workspaceId, projectId), ctx.competitorNotes),
  ]);
}

export async function loadWrCompetitorNotesAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<Array<{ input: string; resolvedName: string; summary: string }>> {
  const data = await loadWrJsonAdmin<Array<{ input: string; resolvedName: string; summary: string }>>(
    admin,
    wrCompetitorsPath(workspaceId, projectId)
  );
  return Array.isArray(data) ? data : [];
}

export async function listWrImagesAdmin(
  admin: SupabaseClient,
  workspaceId: string,
  projectId: string
): Promise<Array<{ name: string; size: number }>> {
  const { data, error } = await admin.storage
    .from(WR_STORAGE_BUCKET)
    .list(wrImagesPrefix(workspaceId, projectId), { limit: 50 });
  if (error || !data) return [];
  return data
    .filter((item) => item.id)
    .map((item) => ({ name: item.name, size: item.metadata?.size ?? 0 }));
}

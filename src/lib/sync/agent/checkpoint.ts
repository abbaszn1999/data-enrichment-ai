import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncSheet } from "@/lib/sync/core/types";

const BUCKET = "workspace-files";
const CHECKPOINT_EVERY = 20;

export function storeAssistantCheckpointPath(workspaceId: string): string {
  return `${workspaceId}/store-assistant/checkpoint.json`;
}

export type StoreAssistantCheckpoint = {
  sheet: SyncSheet;
  processed: number;
  total: number;
  column?: string;
  updatedAt: string;
};

export function shouldWriteCheckpoint(processed: number): boolean {
  return processed > 0 && processed % CHECKPOINT_EVERY === 0;
}

export async function saveStoreAssistantCheckpoint(
  admin: SupabaseClient,
  workspaceId: string,
  payload: Omit<StoreAssistantCheckpoint, "updatedAt">
): Promise<void> {
  const body = JSON.stringify({
    ...payload,
    updatedAt: new Date().toISOString(),
  } satisfies StoreAssistantCheckpoint);
  const { error } = await admin.storage.from(BUCKET).upload(
    storeAssistantCheckpointPath(workspaceId),
    new Blob([body], { type: "application/json" }),
    { upsert: true, contentType: "application/json", cacheControl: "0" }
  );
  if (error) throw new Error(error.message);
}

export async function loadStoreAssistantCheckpoint(
  admin: SupabaseClient,
  workspaceId: string
): Promise<StoreAssistantCheckpoint | null> {
  const { data, error } = await admin.storage
    .from(BUCKET)
    .download(storeAssistantCheckpointPath(workspaceId));
  if (error || !data) return null;
  const parsed = JSON.parse(await data.text()) as StoreAssistantCheckpoint;
  if (!parsed?.sheet || !Array.isArray(parsed.sheet.rows)) return null;
  return parsed;
}

export async function clearStoreAssistantCheckpoint(
  admin: SupabaseClient,
  workspaceId: string
): Promise<void> {
  await admin.storage.from(BUCKET).remove([storeAssistantCheckpointPath(workspaceId)]);
}

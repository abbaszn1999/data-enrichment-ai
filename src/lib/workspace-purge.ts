import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "workspace-files";
const LIST_PAGE_SIZE = 100;
const REMOVE_BATCH_SIZE = 100;

export async function listStoragePathsUnderPrefix(
  admin: SupabaseClient,
  prefix: string
): Promise<string[]> {
  const files: string[] = [];
  const pending: string[] = [prefix.replace(/\/$/, "")];

  while (pending.length > 0) {
    const folder = pending.pop()!;
    let offset = 0;
    for (;;) {
      const { data, error } = await admin.storage
        .from(BUCKET)
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

export async function deleteStoragePrefix(
  admin: SupabaseClient,
  prefix: string
): Promise<number> {
  const paths = await listStoragePathsUnderPrefix(admin, prefix);
  let removed = 0;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
    const batch = paths.slice(i, i + REMOVE_BATCH_SIZE);
    const { error } = await admin.storage.from(BUCKET).remove(batch);
    if (error) {
      console.error("[deleteStoragePrefix] batch failed:", error.message);
      continue;
    }
    removed += batch.length;
  }
  return removed;
}

export async function purgeWorkspace(
  admin: SupabaseClient,
  workspaceId: string
): Promise<{ filesDeleted: number }> {
  const filesDeleted = await deleteStoragePrefix(admin, workspaceId);
  const { error } = await admin.from("workspaces").delete().eq("id", workspaceId);
  if (error) throw new Error(error.message);
  return { filesDeleted };
}

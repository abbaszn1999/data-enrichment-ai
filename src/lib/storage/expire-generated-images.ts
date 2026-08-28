import type { SupabaseClient } from "@supabase/supabase-js";

export const GENERATED_IMAGE_TTL_DAYS = 30;
export const GENERATED_IMAGE_BUCKET = "workspace-files";
export const EXPIRE_LIST_LIMIT = 500;
export const EXPIRE_REMOVE_BATCH = 100;
export const EXPIRE_MAX_PER_RUN = 2000;

const ROW_IMAGE_PATH =
  /(?:^|\/)(?:gallery|description-visualizer)\/[^/]+\/rows\//;

export function isGeneratedRowImagePath(path: string): boolean {
  if (!path || path.includes("..") || path.includes("/settings/")) return false;
  return ROW_IMAGE_PATH.test(path);
}

type ListRow = { object_name?: string | null };

export async function listExpiredGeneratedImagePaths(
  admin: SupabaseClient,
  days = GENERATED_IMAGE_TTL_DAYS,
  limit = EXPIRE_LIST_LIMIT
): Promise<string[]> {
  const { data, error } = await admin.rpc("list_expired_generated_images", {
    p_days: days,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const paths: string[] = [];
  for (const row of (data ?? []) as ListRow[]) {
    const name = String(row.object_name ?? "").trim();
    if (isGeneratedRowImagePath(name)) paths.push(name);
  }
  return paths;
}

export async function expireGeneratedImages(
  admin: SupabaseClient,
  options?: { days?: number; max?: number }
): Promise<{ listed: number; deleted: number; failed: number }> {
  const days = options?.days ?? GENERATED_IMAGE_TTL_DAYS;
  const max = options?.max ?? EXPIRE_MAX_PER_RUN;
  let listed = 0;
  let deleted = 0;
  let failed = 0;

  while (deleted + failed < max) {
    const remaining = max - deleted - failed;
    const paths = await listExpiredGeneratedImagePaths(
      admin,
      days,
      Math.min(EXPIRE_LIST_LIMIT, remaining)
    );
    if (paths.length === 0) break;
    listed += paths.length;

    for (let i = 0; i < paths.length; i += EXPIRE_REMOVE_BATCH) {
      const batch = paths.slice(i, i + EXPIRE_REMOVE_BATCH);
      const { error } = await admin.storage.from(GENERATED_IMAGE_BUCKET).remove(batch);
      if (error) {
        console.error("[expire-generated-images] batch failed:", error.message);
        failed += batch.length;
        continue;
      }
      deleted += batch.length;
    }

    if (paths.length < Math.min(EXPIRE_LIST_LIMIT, remaining)) break;
  }

  return { listed, deleted, failed };
}

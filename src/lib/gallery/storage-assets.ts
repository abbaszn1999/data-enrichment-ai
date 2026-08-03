import { createAdminClient } from "@/lib/supabase-admin";
import { galleryWarn } from "@/lib/gallery/log";

type Admin = ReturnType<typeof createAdminClient>;
const BUCKET = "workspace-files";

async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export async function uploadGalleryAsset(
  admin: Admin,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  await retry(async () => {
    const { error } = await admin.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
  });
}

export async function removeGalleryAssets(
  admin: Admin,
  paths: string[]
): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    await retry(async () => {
      const { error } = await admin.storage.from(BUCKET).remove(unique);
      if (error) throw error;
    });
  } catch (error) {
    galleryWarn("storage:cleanup", "Could not remove gallery assets", {
      count: unique.length,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

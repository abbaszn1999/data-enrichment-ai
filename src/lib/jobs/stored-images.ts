import { createAdminClient } from "@/lib/supabase-admin";
import { isStoredImageRef, storedImagePath } from "@/lib/stored-image-ref";

const BUCKET = "workspace-files";
/** Long enough for a whole job: the link is read by the model while the row runs. */
export const STORED_IMAGE_LINK_TTL_SEC = 6 * 60 * 60;
const SIGN_CHUNK = 40;

export type SignStoredPaths = (paths: string[], expiresInSec: number) => Promise<Record<string, string>>;

async function signWithAdmin(paths: string[], expiresInSec: number): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const signed: Record<string, string> = {};
  for (let start = 0; start < paths.length; start += SIGN_CHUNK) {
    const chunk = paths.slice(start, start + SIGN_CHUNK);
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(chunk, expiresInSec);
    if (error) throw error;
    (data ?? []).forEach((item, index) => {
      if (item?.signedUrl && chunk[index]) signed[chunk[index]] = item.signedUrl;
    });
  }
  return signed;
}

/**
 * Turns the sheet's saved pictures (`vz-storage:` references) into links the
 * model can open, leaving ordinary URLs alone. A picture that can no longer be
 * signed is dropped, so the row still runs on its text.
 */
export async function resolveStoredImageUrls(
  urls: string[],
  sign: SignStoredPaths = signWithAdmin
): Promise<string[]> {
  const paths = [...new Set(urls.filter(isStoredImageRef).map(storedImagePath))];
  if (paths.length === 0) return urls;

  let signed: Record<string, string> = {};
  try {
    signed = await sign(paths, STORED_IMAGE_LINK_TTL_SEC);
  } catch (error) {
    console.warn("Could not sign stored sheet pictures:", error);
  }

  const out: string[] = [];
  for (const url of urls) {
    if (!isStoredImageRef(url)) {
      out.push(url);
      continue;
    }
    const link = signed[storedImagePath(url)];
    if (link && !out.includes(link)) out.push(link);
  }
  return out;
}

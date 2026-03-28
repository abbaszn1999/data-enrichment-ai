import { createClient } from "@/lib/supabase-browser";

const BUCKET = "workspace-files";

export async function uploadWorkspaceFile(
  workspaceId: string,
  folder: "master" | "supplier" | "exports" | "logos" | "categories",
  file: File | Blob,
  fileName: string
): Promise<{ storagePath: string; publicUrl?: string }> {
  const supabase = createClient();
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${workspaceId}/${folder}/${safeName}_${timestamp}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) throw error;
  return { storagePath };
}

export async function downloadWorkspaceFile(storagePath: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);
  if (error) throw error;
  return data;
}

export async function getSignedUrl(
  storagePath: string,
  expiresIn = 3600
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteWorkspaceFile(storagePath: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([storagePath]);
  if (error) throw error;
}

export async function uploadWorkspaceLogo(
  workspaceId: string,
  file: File
): Promise<string> {
  const supabase = createClient();
  const ext = file.name.split(".").pop() || "png";
  const storagePath = `${workspaceId}/logos/logo.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);

  return data.publicUrl;
}

import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase-admin";

const EXPORT_BUCKET = "workspace-files";
const LINK_TTL_SEC = 60 * 60;

/**
 * Hands a built export to the browser. Large sheets can exceed serverless
 * response-body limits, so the file is stored and the client gets a short-lived
 * signed link to download directly. If storage fails, the bytes are sent inline.
 */
export async function deliverExportFile(params: {
  admin: ReturnType<typeof createAdminClient>;
  path: string;
  buffer: Buffer;
  contentType: string;
  fileName: string;
  headers?: HeadersInit;
  /** Redirect to the file instead of returning its link (plain browser GET). */
  redirect?: boolean;
  onStorageError?: (message: string) => void;
}): Promise<NextResponse> {
  const { admin, path, buffer, contentType, fileName, headers, redirect, onStorageError } =
    params;

  const { error: uploadError } = await admin.storage
    .from(EXPORT_BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (!uploadError) {
    const { data: signed, error: signError } = await admin.storage
      .from(EXPORT_BUCKET)
      .createSignedUrl(path, LINK_TTL_SEC, { download: fileName });
    if (signed?.signedUrl) {
      if (redirect) return NextResponse.redirect(signed.signedUrl, 303);
      return NextResponse.json(
        { downloadUrl: signed.signedUrl, fileName, size: buffer.length, contentType },
        { headers: { ...headers, "Cache-Control": "no-store", "X-Export-Path": path } }
      );
    }
    onStorageError?.(signError?.message ?? "Could not sign export link");
  } else {
    onStorageError?.(uploadError.message);
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

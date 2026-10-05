import { NextRequest, NextResponse } from "next/server";
import { imageSize } from "image-size";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import {
  createSignedUrlsAdmin,
  removeGalleryPathsAdmin,
  uploadGalleryBytesAdmin,
} from "@/lib/gallery/storage-admin";
import { getGalleryPrefix } from "@/lib/gallery/storage-paths";
import { isGalleryPhotoPath } from "@/lib/gallery/image-urls";

type Ctx = { params: Promise<{ sessionId: string }> };

const CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 10 * 1024 * 1024;
const ROW_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

async function authorizeSession(sessionId: string, workspaceId: string) {
  const auth = await requireGalleryAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return { response: auth.response } as const;
  const { data: session, error } = await auth.admin
    .from("gallery_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !session) {
    return {
      response: NextResponse.json(
        { error: "Gallery session not found" },
        { status: 404, headers: auth.headers }
      ),
    } as const;
  }
  if (session.status === "processing") {
    return {
      response: NextResponse.json(
        { error: "Photos cannot be changed during generation" },
        { status: 409, headers: auth.headers }
      ),
    } as const;
  }
  return { auth } as const;
}

export async function POST(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const form = await request.formData().catch(() => null);
  const workspaceId = String(form?.get("workspaceId") || "");
  const rowId = String(form?.get("rowId") || "");
  const file = form?.get("file");
  if (!workspaceId || !ROW_ID_RE.test(rowId) || !(file instanceof File)) {
    return NextResponse.json(
      { error: "workspaceId, rowId, and an image file are required" },
      { status: 400 }
    );
  }
  const ext = CONTENT_TYPES[file.type];
  if (!ext || file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `${file.name || "Photo"}: use a JPG, PNG, or WebP image up to 10 MB` },
      { status: 400 }
    );
  }

  const loaded = await authorizeSession(sessionId, workspaceId);
  if ("response" in loaded) return loaded.response;

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const dimensions = imageSize(buffer);
    const width = dimensions.width || 0;
    const height = dimensions.height || 0;
    if (!width || !height || width * height > 60_000_000) {
      throw new Error("Invalid image dimensions");
    }
  } catch {
    return NextResponse.json(
      { error: `${file.name || "Photo"} is not a valid supported image` },
      { status: 400, headers: loaded.auth.headers }
    );
  }

  const path = `${getGalleryPrefix(workspaceId, sessionId)}/rows/${rowId}/upload-${crypto.randomUUID()}.${ext}`;
  try {
    await uploadGalleryBytesAdmin(path, buffer, file.type);
    return NextResponse.json(
      { path, signedUrls: await createSignedUrlsAdmin([path]) },
      { headers: loaded.auth.headers }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500, headers: loaded.auth.headers }
    );
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
    paths?: string[];
  } | null;
  const workspaceId = String(body?.workspaceId || "");
  const paths = Array.isArray(body?.paths) ? body.paths.map(String) : [];
  if (!workspaceId || paths.length === 0 || paths.length > 50) {
    return NextResponse.json(
      { error: "workspaceId and photo paths are required" },
      { status: 400 }
    );
  }
  const loaded = await authorizeSession(sessionId, workspaceId);
  if ("response" in loaded) return loaded.response;

  const removable = paths.filter(
    (path) =>
      isGalleryPhotoPath(path, workspaceId, sessionId) &&
      /\/rows\/[^/]+\/upload-[^/]+$/.test(path)
  );
  await removeGalleryPathsAdmin(removable).catch(() => undefined);
  return NextResponse.json({ removed: removable.length }, { headers: loaded.auth.headers });
}

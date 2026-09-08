import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireWrAuth } from "@/lib/website-restructure/auth";
import { assetDeleteBodySchema, assetUploadBodySchema, jsonError } from "@/lib/website-restructure/api-schema";
import { getWrProjectRow, updateWrProjectState } from "@/lib/website-restructure/server-persist";
import { WR_MAX_IMAGES } from "@/lib/website-restructure/types";
import {
  WR_STORAGE_BUCKET,
  wrChatAttachmentPath,
  wrImagePath,
  wrLogoPath,
} from "@/lib/website-restructure/storage";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mimeType.toLowerCase()] || "jpg";
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = assetUploadBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid upload payload", 400);
  const { workspaceId, projectId, kind, filename, mimeType, dataBase64 } = parsed.data;

  if (!mimeType.toLowerCase().startsWith("image/")) {
    return jsonError("Only image uploads are supported", 400);
  }

  const auth = await requireWrAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  try {
    const project = await getWrProjectRow(auth.admin, workspaceId, projectId);
    if (!project) return jsonError("Project not found", 404);

    let buffer: Buffer;
    try {
      buffer = Buffer.from(dataBase64, "base64");
    } catch {
      return jsonError("Invalid image data", 400);
    }
    if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
      return jsonError(`Image must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`, 400);
    }

    if (kind === "image" && project.state.images.length >= WR_MAX_IMAGES) {
      return jsonError(`Limit of ${WR_MAX_IMAGES} images reached`, 409);
    }

    const ext = extFromMime(mimeType);
    const assetId = randomUUID();
    const path =
      kind === "logo"
        ? wrLogoPath(workspaceId, projectId, ext)
        : kind === "chat"
          ? wrChatAttachmentPath(workspaceId, projectId, assetId, ext)
          : wrImagePath(workspaceId, projectId, assetId, ext);

    const { error: uploadError } = await auth.admin.storage
      .from(WR_STORAGE_BUCKET)
      .upload(path, buffer, { contentType: mimeType, upsert: true });
    if (uploadError) throw uploadError;

    const asset = {
      id: assetId,
      storagePath: path,
      filename: filename.slice(0, 200),
      mimeType,
    };

    // Chat attachments live on the edit message, not in the screenshot/logo slots.
    if (kind !== "chat") {
      const stored = { id: asset.id, storagePath: asset.storagePath, filename: asset.filename };
      const nextState =
        kind === "logo"
          ? { ...project.state, logo: stored }
          : { ...project.state, images: [...project.state.images, stored] };
      await updateWrProjectState(auth.admin, workspaceId, projectId, nextState);
    }

    const { data: signed } = await auth.admin.storage
      .from(WR_STORAGE_BUCKET)
      .createSignedUrl(path, 3600);

    return NextResponse.json(
      { ok: true, asset, url: signed?.signedUrl ?? null },
      { headers: auth.headers }
    );
  } catch (error) {
    console.error("[website-restructure/assets] upload failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload image" },
      { status: 500, headers: auth.headers }
    );
  }
}

export async function DELETE(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = assetDeleteBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid delete payload", 400);
  const { workspaceId, projectId, kind, imageId } = parsed.data;

  const auth = await requireWrAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  try {
    const project = await getWrProjectRow(auth.admin, workspaceId, projectId);
    if (!project) return jsonError("Project not found", 404);

    const pathsToRemove: string[] = [];
    let nextState = project.state;

    if (kind === "logo") {
      if (project.state.logo) pathsToRemove.push(project.state.logo.storagePath);
      nextState = { ...project.state, logo: null };
    } else {
      const target = project.state.images.find((img) => img.id === imageId);
      if (target) pathsToRemove.push(target.storagePath);
      nextState = { ...project.state, images: project.state.images.filter((img) => img.id !== imageId) };
    }

    if (pathsToRemove.length > 0) {
      await auth.admin.storage.from(WR_STORAGE_BUCKET).remove(pathsToRemove);
    }
    await updateWrProjectState(auth.admin, workspaceId, projectId, nextState);

    return NextResponse.json({ ok: true }, { headers: auth.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete asset" },
      { status: 500, headers: auth.headers }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { STORE_AGENT_LIMITS } from "@/lib/store-agent/protocol";
import { STORE_AGENT_FILES_BUCKET, authorizeStoreAgent, loadOwnedChat } from "@/lib/store-agent/server";
import { encodeStorageSegment } from "@/lib/store-agent/storage-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** Upload one attachment into a chat. Returns its id for the next message. */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  const workspaceId = String(form.get("workspaceId") ?? "");
  const chatId = String(form.get("chatId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });

  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;
  const chat = await loadOwnedChat(access, workspaceId, chatId);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime)) {
    return NextResponse.json({ error: "This file type is not supported. Use images, PDF, CSV, Excel, text or JSON." }, { status: 415 });
  }
  const max = mime.startsWith("image/") ? STORE_AGENT_LIMITS.maxImageBytes : STORE_AGENT_LIMITS.maxFileBytes;
  if (file.size > max) return NextResponse.json({ error: `The file is larger than ${Math.round(max / 1024 / 1024)} MB.` }, { status: 413 });

  const safeName = file.name.replace(/[^\w.\- ()؀-ۿ]+/g, "_").slice(0, 120) || "file";
  const storagePath = `${workspaceId}/${chatId}/uploads/${encodeStorageSegment(`${randomUUID()}-${safeName}`)}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await access.admin.storage
    .from(STORE_AGENT_FILES_BUCKET)
    .upload(storagePath, bytes, { contentType: mime, upsert: false });
  if (uploadError) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const { data, error } = await access.admin
    .from("store_agent_files")
    .insert({
      chat_id: chatId,
      workspace_id: workspaceId,
      name: safeName,
      kind: "upload",
      storage_path: storagePath,
      mime,
      size: bytes.length,
      created_by: "user",
    })
    .select("id, name, mime, size")
    .single();
  if (error || !data) return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  return NextResponse.json({ file: data });
}

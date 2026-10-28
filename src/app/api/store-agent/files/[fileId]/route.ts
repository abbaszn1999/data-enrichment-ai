import { NextRequest, NextResponse } from "next/server";
import { STORE_AGENT_FILES_BUCKET, authorizeStoreAgent } from "@/lib/store-agent/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ fileId: string }> };

const TEXT = /^(text\/|application\/json)/;

/**
 * A chat file the user owns. Text comes back inline (`?format=json`) for the
 * panel; anything else redirects to a short-lived signed URL.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { fileId } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const access = await authorizeStoreAgent({ workspaceId });
  if (access instanceof NextResponse) return access;

  const { data: file } = await access.admin
    .from("store_agent_files")
    .select("id, chat_id, name, mime, size, storage_path, store_agent_chats!inner(user_id, workspace_id)")
    .eq("id", fileId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const chat = (file as { store_agent_chats?: { user_id: string } } | null)?.store_agent_chats;
  if (!file || chat?.user_id !== access.userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  if (request.nextUrl.searchParams.get("format") === "json" && TEXT.test(String(file.mime)) && Number(file.size) <= 5 * 1024 * 1024) {
    const { data, error } = await access.admin.storage.from(STORE_AGENT_FILES_BUCKET).download(String(file.storage_path));
    if (error || !data) return NextResponse.json({ error: "Could not open the file" }, { status: 500 });
    return NextResponse.json({ name: file.name, mime: file.mime, size: file.size, text: await data.text() });
  }

  const { data, error } = await access.admin.storage
    .from(STORE_AGENT_FILES_BUCKET)
    .createSignedUrl(String(file.storage_path), 300, download ? { download: String(file.name) } : undefined);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Could not open the file" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { status: 302 });
}

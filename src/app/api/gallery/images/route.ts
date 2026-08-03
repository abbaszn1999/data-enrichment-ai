import { NextRequest, NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";
import { createSignedUrlsAdmin } from "@/lib/gallery/storage-admin";
import { getGalleryPrefix } from "@/lib/gallery/storage-paths";

/**
 * Authenticated redirect to a short-lived Supabase signed URL.
 * Paths must sit under this session's gallery prefix. We intentionally do not
 * require the path to already appear in worksheet.json — right after generate,
 * the client often has the new path before a stale worksheet download does.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  const path = request.nextUrl.searchParams.get("path");
  if (!workspaceId || !sessionId || !path) {
    return NextResponse.json({ error: "Missing image parameters" }, { status: 400 });
  }

  const prefix = `${getGalleryPrefix(workspaceId, sessionId)}/`;
  if (path.includes("..") || !path.startsWith(prefix)) {
    return NextResponse.json({ error: "Invalid image path" }, { status: 400 });
  }

  const auth = await requireGalleryAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const { data: session } = await auth.admin
    .from("gallery_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const signed = await createSignedUrlsAdmin([path], 60);
  if (!signed[path]) {
    return NextResponse.json(
      { error: "Could not create image URL" },
      { status: 503 }
    );
  }
  return NextResponse.redirect(signed[path]);
}

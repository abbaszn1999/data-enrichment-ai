import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

const BUCKET = "workspace-files";

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { workspaceId } = await req.json();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // 2. Verify the user is the owner of this workspace
    const { data: member } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (!member || member.role !== "owner") {
      return NextResponse.json({ error: "Only the workspace owner can delete it" }, { status: 403 });
    }

    // 3. Delete ALL files from Storage under this workspace folder
    //    Storage files are stored as: {workspaceId}/...
    //    We list recursively and delete in batches.
    let allFiles: string[] = [];

    // List files at workspace root (categories.json, categories-raw.json, suppliers.json, etc.)
    const { data: rootFiles } = await admin.storage
      .from(BUCKET)
      .list(workspaceId, { limit: 1000 });
    if (rootFiles) {
      for (const f of rootFiles) {
        if (f.id) {
          // It's a file
          allFiles.push(`${workspaceId}/${f.name}`);
        }
      }
    }

    // List files in subfolders: projects/, master/
    const subfolders = ["projects", "master"];
    for (const folder of subfolders) {
      const { data: subFiles } = await admin.storage
        .from(BUCKET)
        .list(`${workspaceId}/${folder}`, { limit: 1000 });
      if (subFiles) {
        for (const f of subFiles) {
          if (f.id) {
            allFiles.push(`${workspaceId}/${folder}/${f.name}`);
          }
        }
      }
    }

    // Delete all collected files in one batch (Supabase supports array remove)
    if (allFiles.length > 0) {
      const { error: storageError } = await admin.storage
        .from(BUCKET)
        .remove(allFiles);
      if (storageError) {
        console.error("Storage cleanup error (non-fatal):", storageError.message);
        // Continue anyway — DB cleanup is more important
      }
    }

    // 4. Delete workspace from DB (CASCADE handles members, sessions, etc.)
    const { error: dbError } = await admin
      .from("workspaces")
      .delete()
      .eq("id", workspaceId);

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, filesDeleted: allFiles.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

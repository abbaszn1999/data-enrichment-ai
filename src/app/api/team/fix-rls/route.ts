import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  try {
    // Auth check - only allow authenticated users
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Step 1: Drop all existing policies on workspace_members
    const { error: err1 } = await admin.rpc("exec_sql", {
      sql: `
        DO $$ 
        DECLARE pol RECORD;
        BEGIN
          FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'workspace_members'
          LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON workspace_members', pol.policyname);
          END LOOP;
        END $$;
      `,
    });

    // If exec_sql doesn't exist, try raw SQL via individual statements
    // We'll use the admin client to run each policy change

    // Step 2: Recreate the helper function
    const { error: err2 } = await admin.rpc("exec_sql", {
      sql: `
        CREATE OR REPLACE FUNCTION is_workspace_member(ws_id UUID, min_role TEXT DEFAULT 'viewer')
        RETURNS BOOLEAN AS $$
          SELECT EXISTS (
            SELECT 1 FROM workspace_members
            WHERE workspace_id = ws_id
            AND user_id = auth.uid()
            AND CASE min_role
              WHEN 'owner'  THEN role = 'owner'
              WHEN 'admin'  THEN role IN ('owner', 'admin')
              WHEN 'editor' THEN role IN ('owner', 'admin', 'editor')
              WHEN 'viewer' THEN role IN ('owner', 'admin', 'editor', 'viewer')
            END
          );
        $$ LANGUAGE sql SECURITY DEFINER;
      `,
    });

    // Step 3: Create new SELECT policy
    const { error: err3 } = await admin.rpc("exec_sql", {
      sql: `CREATE POLICY "members_select" ON workspace_members FOR SELECT USING (is_workspace_member(workspace_id));`,
    });

    // Step 4: Create INSERT policy
    const { error: err4 } = await admin.rpc("exec_sql", {
      sql: `CREATE POLICY "members_insert" ON workspace_members FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));`,
    });

    // Step 5: Create UPDATE policy
    const { error: err5 } = await admin.rpc("exec_sql", {
      sql: `CREATE POLICY "members_update" ON workspace_members FOR UPDATE USING (is_workspace_member(workspace_id, 'admin') AND user_id != auth.uid());`,
    });

    // Step 6: Create DELETE policy
    const { error: err6 } = await admin.rpc("exec_sql", {
      sql: `CREATE POLICY "members_delete" ON workspace_members FOR DELETE USING (is_workspace_member(workspace_id, 'admin') AND user_id != auth.uid());`,
    });

    return NextResponse.json({
      step1_drop: err1?.message || "OK",
      step2_function: err2?.message || "OK",
      step3_select: err3?.message || "OK",
      step4_insert: err4?.message || "OK",
      step5_update: err5?.message || "OK",
      step6_delete: err6?.message || "OK",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

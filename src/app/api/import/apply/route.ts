import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  loadProjectJsonServer,
  loadProductsJsonServer,
  saveProductsJsonServer,
} from "@/lib/storage-helpers-server";

export async function POST(request: Request) {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const supabase = await createClient();

    // Load session metadata from DB
    const { data: session, error: sessionError } = await supabase
      .from("import_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Load project rows from Storage
    const project = await loadProjectJsonServer(session.workspace_id, sessionId);
    if (!project) {
      return NextResponse.json({ error: "Project data not found" }, { status: 404 });
    }

    // Load existing master products from Storage
    const masterProducts = await loadProductsJsonServer(session.workspace_id);
    const masterMap = new Map(masterProducts.map((p) => [p.sku, p]));

    // Merge enriched data from project rows into master products
    let updated = 0;
    let added = 0;

    for (const row of project.rows) {
      const sku = row.originalData?.sku || row.originalData?.SKU || "";
      if (!sku) continue;

      if (masterMap.has(sku)) {
        // Update existing product with enriched data
        const existing = masterMap.get(sku)!;
        masterMap.set(sku, {
          ...existing,
          data: { ...existing.data, ...row.originalData },
          enrichedData: { ...(existing.enrichedData || {}), ...(row.enrichedData || {}) },
        });
        updated++;
      } else {
        // Add as new product
        masterMap.set(sku, {
          sku,
          data: row.originalData || {},
          enrichedData: row.enrichedData || {},
          status: "active",
          createdAt: new Date().toISOString(),
        });
        added++;
      }
    }

    // Save merged products back to Storage
    await saveProductsJsonServer(session.workspace_id, Array.from(masterMap.values()));

    // Update session in DB
    await supabase
      .from("import_sessions")
      .update({ updated_count: updated, updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    // Log activity
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("activity_log").insert({
        workspace_id: session.workspace_id,
        user_id: user.id,
        action: "products_updated",
        entity_type: "import_session",
        entity_id: sessionId,
        details: { updated, added, session_name: session.name },
      });
    }

    return NextResponse.json({ updated, added });
  } catch (error: any) {
    console.error("Apply error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  buildMasterIndex,
  matchSupplierRows,
  generateDiff,
  type MatchingRule,
} from "@/lib/matching";
import {
  loadProjectJsonServer,
  saveProjectJsonServer,
  loadProductsJsonServer,
} from "@/lib/storage-helpers-server";

export async function POST(request: Request) {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const supabase = await createClient();

    // 1. Load import session from DB (metadata only)
    const { data: session, error: sessionError } = await supabase
      .from("import_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // 2. Load project rows from Storage JSON
    const project = await loadProjectJsonServer(session.workspace_id, sessionId);
    if (!project || project.rows.length === 0) {
      return NextResponse.json({ error: "No import rows found in storage." }, { status: 400 });
    }

    // 3. Load master products from Storage JSON
    const masterProducts = await loadProductsJsonServer(session.workspace_id);

    const supplierMatchCol = session.supplier_match_column || project.columns[0];
    const masterMatchCol = session.master_match_column || "sku";

    console.log("[Match API] supplierMatchCol:", supplierMatchCol, "| masterMatchCol:", masterMatchCol);
    console.log("[Match API] masterProducts count:", masterProducts.length);
    console.log("[Match API] project rows count:", project.rows.length);

    // Build master SKU list — check both p.sku and p.data[masterMatchCol]
    const masterSkus = masterProducts.map((p) => {
      const val = masterMatchCol === "sku" ? p.sku : (p.data?.[masterMatchCol] ?? p.sku);
      return { id: p.sku, sku: val };
    });

    if (masterSkus.length > 0) {
      console.log("[Match API] Sample master SKU entries:", masterSkus.slice(0, 3).map(m => ({ id: m.id, sku: m.sku })));
    }

    // 4. Run matching
    const rules: MatchingRule[] = session.matching_rules || [];
    console.log("[Match API] matching_rules count:", rules.length, "| enabled:", rules.filter(r => r.enabled).length);
    const masterIndex = buildMasterIndex(masterSkus, rules);
    console.log("[Match API] masterIndex size:", masterIndex.size);

    const supplierRows = project.rows.map((r) => ({
      rowIndex: r.rowIndex,
      sku: r.originalData?.[supplierMatchCol] ?? "",
      data: r.originalData || {},
    }));

    if (supplierRows.length > 0) {
      console.log("[Match API] Sample supplier rows:", supplierRows.slice(0, 3).map(s => ({ rowIndex: s.rowIndex, sku: s.sku })));
    }

    const matchResults = matchSupplierRows(supplierRows, masterIndex, rules);
    console.log("[Match API] matchResults:", { total: matchResults.length, existing: matchResults.filter(r => r.matchType === "existing").length, new: matchResults.filter(r => r.matchType === "new").length, ambiguous: matchResults.filter(r => r.matchType === "ambiguous").length });

    // Build a lookup map of master products by SKU for diff generation
    const masterMap = new Map<string, typeof masterProducts[0]>();
    for (const p of masterProducts) {
      masterMap.set(p.sku, p);
    }

    // Build column mapping from project columns (identity mapping)
    const columnMapping: Record<string, string> = {};
    for (const col of project.columns) { columnMapping[col] = col; }

    // 5. Update project rows with match results and diff data, save back to Storage
    let existingCount = 0;
    let newCount = 0;
    let ambiguousCount = 0;

    for (const result of matchResults) {
      const row = project.rows.find((r) => r.rowIndex === result.rowIndex);
      if (!row) continue;

      if (result.matchType === "existing" && result.matchedProductSku) {
        row.matchType = "existing";
        (row as any).matchedProductSku = result.matchedProductSku;

        // Generate diff between supplier data and master product data
        const masterProduct = masterMap.get(result.matchedProductSku);
        if (masterProduct?.data && row.originalData) {
          const diff = generateDiff(row.originalData, masterProduct.data, columnMapping);
          (row as any).diffData = diff;
        }
        existingCount++;
      } else if (result.matchType === "new") {
        row.matchType = "new";
        newCount++;
      } else {
        row.matchType = "new";
        ambiguousCount++;
      }
    }

    // Save updated project back to Storage
    await saveProjectJsonServer(session.workspace_id, sessionId, project);

    // 6. Update session counts and status in DB
    await supabase
      .from("import_sessions")
      .update({
        existing_count: existingCount,
        new_count: newCount,
        status: "review",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    return NextResponse.json({
      existing: existingCount,
      new: newCount,
      ambiguous: ambiguousCount,
      total: matchResults.length,
    });
  } catch (error: any) {
    console.error("Match error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

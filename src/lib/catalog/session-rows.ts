import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectJson, ProjectRow } from "@/lib/storage-helpers";
import type { SessionKind } from "@/types";
import { loadAllOrderedRows } from "@/lib/catalog/row-store-page";

const UPSERT_CHUNK = 250;

type SessionRowRecord = {
  session_id: string;
  row_id: string;
  row_index: number;
  status: ProjectRow["status"];
  error_message: string | null;
  original_data: Record<string, string>;
  enriched_data: Record<string, unknown>;
  match_type: ProjectRow["matchType"] | null;
  updated_at: string;
};

export function shouldRecomputeMatchTypes(
  project: Pick<ProjectJson, "rows" | "matchingSkipped">,
  kind: SessionKind
): boolean {
  if (kind === "plp") return false;
  if (project.matchingSkipped) return false;
  return !project.rows.every(
    (row) => row.matchType === "existing" || row.matchType === "new"
  );
}

export function projectRowToRecord(
  sessionId: string,
  row: ProjectRow
): SessionRowRecord {
  return {
    session_id: sessionId,
    row_id: row.id,
    row_index: row.rowIndex,
    status: row.status,
    error_message: row.errorMessage ?? null,
    original_data: row.originalData ?? {},
    enriched_data: row.enrichedData ?? {},
    match_type: row.matchType ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function recordToProjectRow(row: SessionRowRecord): ProjectRow {
  return {
    id: row.row_id,
    rowIndex: row.row_index,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
    originalData: row.original_data ?? {},
    enrichedData: row.enriched_data ?? {},
    matchType: (row.match_type as ProjectRow["matchType"]) ?? null,
  };
}

export async function countCatalogSessionRows(
  admin: SupabaseClient,
  sessionId: string
): Promise<number> {
  const { count, error } = await admin
    .from("catalog_session_rows")
    .select("row_id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadCatalogSessionRows(
  admin: SupabaseClient,
  sessionId: string
): Promise<ProjectRow[]> {
  const records = await loadAllOrderedRows<SessionRowRecord>({
    fetchPage: async (from, to) => {
      const { data, error } = await admin
        .from("catalog_session_rows")
        .select(
          "session_id, row_id, row_index, status, error_message, original_data, enriched_data, match_type, updated_at"
        )
        .eq("session_id", sessionId)
        .order("row_index", { ascending: true })
        .range(from, to);
      if (error) throw new Error(error.message);
      return (data ?? []) as SessionRowRecord[];
    },
  });
  return records.map(recordToProjectRow);
}

export async function replaceCatalogSessionRows(
  admin: SupabaseClient,
  sessionId: string,
  rows: ProjectRow[]
): Promise<void> {
  const keepIds = rows.map((row) => row.id).filter(Boolean);
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows
      .slice(i, i + UPSERT_CHUNK)
      .map((row) => projectRowToRecord(sessionId, row));
    const { error } = await admin.from("catalog_session_rows").upsert(chunk, {
      onConflict: "session_id,row_id",
    });
    if (error) throw new Error(error.message);
  }
  const { error: pruneError } = await admin.rpc("delete_catalog_session_rows_except", {
    p_session_id: sessionId,
    p_keep_ids: keepIds,
  });
  if (pruneError) throw new Error(pruneError.message);
}

export async function patchCatalogSessionRows(
  admin: SupabaseClient,
  sessionId: string,
  patches: Array<{
    id: string;
    status?: ProjectRow["status"];
    errorMessage?: string | null;
    enrichedData?: Record<string, unknown>;
    originalData?: Record<string, string>;
    matchType?: ProjectRow["matchType"];
  }>
): Promise<void> {
  for (const patch of patches) {
    const { data: current, error: readError } = await admin
      .from("catalog_session_rows")
      .select(
        "row_id, row_index, status, error_message, original_data, enriched_data, match_type"
      )
      .eq("session_id", sessionId)
      .eq("row_id", patch.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) continue;
    const original = {
      ...(current.original_data as Record<string, string>),
      ...(patch.originalData ?? {}),
    };
    const enriched = {
      ...(current.enriched_data as Record<string, unknown>),
      ...(patch.enrichedData ?? {}),
    };
    const { error } = await admin
      .from("catalog_session_rows")
      .update({
        status: patch.status ?? current.status,
        error_message:
          "errorMessage" in patch ? (patch.errorMessage ?? null) : current.error_message,
        original_data: original,
        enriched_data: enriched,
        match_type:
          patch.matchType !== undefined ? patch.matchType : current.match_type,
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId)
      .eq("row_id", patch.id);
    if (error) throw new Error(error.message);
  }
}

export async function hydrateProjectRows(
  admin: SupabaseClient,
  sessionId: string,
  project: ProjectJson
): Promise<ProjectJson> {
  const count = await countCatalogSessionRows(admin, sessionId);
  if (count === 0) {
    if (project.rows.length > 0) {
      await replaceCatalogSessionRows(admin, sessionId, project.rows);
    }
    return project;
  }
  const rows = await loadCatalogSessionRows(admin, sessionId);
  // If the blob still has more rows than a truncated PostgREST read, restore
  // from the blob instead of silently dropping the rest of the worksheet.
  if (project.rows.length > rows.length) {
    await replaceCatalogSessionRows(admin, sessionId, project.rows);
    return project;
  }
  return { ...project, rows };
}

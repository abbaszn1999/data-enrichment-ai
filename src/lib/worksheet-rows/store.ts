import type { SupabaseClient } from "@supabase/supabase-js";

const UPSERT_CHUNK = 250;

export type WorksheetRowTable = "gallery_session_rows" | "visualizer_session_rows";

export type WorksheetRowLike = {
  id: string;
  rowIndex?: number;
  status?: string;
};

type StoredRecord = {
  session_id: string;
  row_id: string;
  row_index: number;
  status: string;
  data: Record<string, unknown>;
  updated_at: string;
};

function pruneRpc(
  table: WorksheetRowTable
): "delete_gallery_session_rows_except" | "delete_visualizer_session_rows_except" {
  return table === "gallery_session_rows"
    ? "delete_gallery_session_rows_except"
    : "delete_visualizer_session_rows_except";
}

export function jsonRowToRecord(sessionId: string, row: WorksheetRowLike): StoredRecord {
  return {
    session_id: sessionId,
    row_id: row.id,
    row_index: Number(row.rowIndex ?? 0),
    status: String(row.status ?? "not_started"),
    data: { ...(row as unknown as Record<string, unknown>) },
    updated_at: new Date().toISOString(),
  };
}

export async function countWorksheetRows(
  admin: SupabaseClient,
  table: WorksheetRowTable,
  sessionId: string
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("row_id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadWorksheetRows<T extends WorksheetRowLike>(
  admin: SupabaseClient,
  table: WorksheetRowTable,
  sessionId: string
): Promise<T[]> {
  const { data, error } = await admin
    .from(table)
    .select("row_id, row_index, status, data")
    .eq("session_id", sessionId)
    .order("row_index", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as StoredRecord[]).map((row) => {
    const payload = (row.data ?? {}) as T;
    return {
      ...payload,
      id: row.row_id,
      rowIndex: row.row_index,
      status: row.status,
    };
  });
}

export async function replaceWorksheetRows(
  admin: SupabaseClient,
  table: WorksheetRowTable,
  sessionId: string,
  rows: WorksheetRowLike[]
): Promise<void> {
  const keepIds = rows.map((row) => row.id).filter(Boolean);
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((row) => jsonRowToRecord(sessionId, row));
    const { error } = await admin.from(table).upsert(chunk, {
      onConflict: "session_id,row_id",
    });
    if (error) throw new Error(error.message);
  }
  const { error: pruneError } = await admin.rpc(pruneRpc(table), {
    p_session_id: sessionId,
    p_keep_ids: keepIds,
  });
  if (pruneError) throw new Error(pruneError.message);
}

export async function upsertWorksheetRow(
  admin: SupabaseClient,
  table: WorksheetRowTable,
  sessionId: string,
  row: WorksheetRowLike
): Promise<void> {
  const { error } = await admin.from(table).upsert(jsonRowToRecord(sessionId, row), {
    onConflict: "session_id,row_id",
  });
  if (error) throw new Error(error.message);
}

export async function hydrateWorksheetRows<T extends { rows: WorksheetRowLike[] }>(
  admin: SupabaseClient,
  table: WorksheetRowTable,
  sessionId: string,
  worksheet: T
): Promise<T> {
  const count = await countWorksheetRows(admin, table, sessionId);
  if (count === 0) {
    if (worksheet.rows.length > 0) {
      await replaceWorksheetRows(admin, table, sessionId, worksheet.rows);
    }
    return worksheet;
  }
  const rows = await loadWorksheetRows<T["rows"][number]>(admin, table, sessionId);
  return { ...worksheet, rows };
}

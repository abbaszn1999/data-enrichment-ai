import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Types ───────────────────────────────────────────────
export interface DBProject {
  id: string;
  name: string;
  file_name: string;
  original_columns: string[];
  source_columns: string[];
  enrichment_columns: any[];
  enrichment_settings: any;
  column_visibility: Record<string, boolean>;
  row_count: number;
  enriched_count: number;
  created_at: string;
  updated_at: string;
}

export interface DBRow {
  id: string;
  project_id: string;
  row_index: number;
  status: string;
  error_message: string | null;
  original_data: Record<string, string>;
  enriched_data: Record<string, any>;
  created_at: string;
}

// ─── Projects CRUD ───────────────────────────────────────

export async function getProjects(): Promise<DBProject[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getProject(id: string): Promise<DBProject | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null; // not found
    throw error;
  }
  return data;
}

export async function createProject(project: {
  name: string;
  file_name: string;
  original_columns: string[];
  source_columns: string[];
  enrichment_columns: any[];
  enrichment_settings: any;
  row_count: number;
}): Promise<DBProject> {
  const { data, error } = await supabase
    .from("projects")
    .insert(project)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(
  id: string,
  updates: Partial<Omit<DBProject, "id" | "created_at">>
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function duplicateProject(id: string, newName: string): Promise<DBProject> {
  // Get original project
  const project = await getProject(id);
  if (!project) throw new Error("Project not found");

  // Create new project
  const newProject = await createProject({
    name: newName,
    file_name: project.file_name,
    original_columns: project.original_columns,
    source_columns: project.source_columns,
    enrichment_columns: project.enrichment_columns,
    enrichment_settings: project.enrichment_settings,
    row_count: project.row_count,
  });

  // Copy all rows
  const rows = await getProjectRows(id);
  if (rows.length > 0) {
    const newRows = rows.map((r) => ({
      project_id: newProject.id,
      row_index: r.row_index,
      status: r.status,
      error_message: r.error_message,
      original_data: r.original_data,
      enriched_data: r.enriched_data,
    }));

    // Insert in batches of 500
    for (let i = 0; i < newRows.length; i += 500) {
      const batch = newRows.slice(i, i + 500);
      const { error } = await supabase.from("rows").insert(batch);
      if (error) throw error;
    }
  }

  return newProject;
}

// ─── Rows CRUD ───────────────────────────────────────────

export async function getProjectRows(projectId: string): Promise<DBRow[]> {
  const { data, error } = await supabase
    .from("rows")
    .select("*")
    .eq("project_id", projectId)
    .order("row_index", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function insertRows(
  rows: Omit<DBRow, "id" | "created_at">[]
): Promise<void> {
  // Insert in batches of 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from("rows").insert(batch);
    if (error) throw error;
  }
}

export async function updateRow(
  id: string,
  updates: Partial<Pick<DBRow, "status" | "error_message" | "original_data" | "enriched_data" | "row_index">>
): Promise<void> {
  const { error } = await supabase.from("rows").update(updates).eq("id", id);
  if (error) throw error;
}

export async function updateRowsBatch(
  updates: { id: string; changes: Partial<Pick<DBRow, "status" | "error_message" | "enriched_data">> }[]
): Promise<void> {
  // Supabase doesn't support batch updates natively, so we use Promise.all with small batches
  const batchSize = 50;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await Promise.all(
      batch.map(({ id, changes }) =>
        supabase.from("rows").update(changes).eq("id", id)
      )
    );
  }
}

export async function deleteRows(ids: string[]): Promise<void> {
  const { error } = await supabase.from("rows").delete().in("id", ids);
  if (error) throw error;
}

// ─── Sync helpers ────────────────────────────────────────

export async function saveProjectState(
  projectId: string,
  state: {
    source_columns?: string[];
    enrichment_columns?: any[];
    enrichment_settings?: any;
    column_visibility?: Record<string, boolean>;
    enriched_count?: number;
  }
): Promise<void> {
  await updateProject(projectId, state);
}

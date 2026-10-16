import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectTool } from "./protocol";

/** Per tool, sized so the whole answer fits the agent's tool-result cap. */
export const PROJECTS_PER_TOOL = { one: 40, all: 8 } as const;

export type AgentProject = {
  id: string;
  name: string;
  status: string;
  updatedAt: string | null;
  /** Rows, products or images, when the tool has them. */
  items?: number;
  kind?: string;
  phase?: string;
  /** Workspace path that opens the project. */
  open: string;
  /** Control to click after opening, for tools whose projects do not have their own URL. */
  select?: string;
};

export type AgentProjectList = Partial<Record<ProjectTool, { projects: AgentProject[]; more: boolean } | { error: string }>>;

type Row = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Same rule as the Catalog Intelligence list: a project opens on the step it is at. */
export function catalogProjectPath(slug: string, id: string, status: string): string {
  const base = `/w/${slug}/catalog-intelligence/${id}`;
  if (status === "enriching" || status === "completed") return base;
  if (status === "review") return `${base}/review`;
  return `${base}/rules`;
}

type Source = {
  table: string;
  columns: string;
  toProject: (row: Row, slug: string) => AgentProject;
};

const SOURCES: Record<Exclude<ProjectTool, "store">, Source> = {
  catalog: {
    table: "catalog_sessions",
    columns: "id, name, status, kind, total_rows, updated_at",
    toProject: (row, slug) => ({
      id: str(row.id),
      name: str(row.name),
      status: str(row.status),
      updatedAt: str(row.updated_at) || null,
      items: num(row.total_rows),
      kind: str(row.kind) || "product",
      open: catalogProjectPath(slug, str(row.id), str(row.status)),
    }),
  },
  gallery: {
    table: "gallery_sessions",
    columns: "id, name, status, total_rows, updated_at",
    toProject: (row, slug) => ({
      id: str(row.id),
      name: str(row.name),
      status: str(row.status),
      updatedAt: str(row.updated_at) || null,
      items: num(row.total_rows),
      open: `/w/${slug}/products-gallery?project=${str(row.id)}`,
    }),
  },
  visualizer: {
    table: "visualizer_sessions",
    columns: "id, name, status, total_rows, updated_at",
    toProject: (row, slug) => ({
      id: str(row.id),
      name: str(row.name),
      status: str(row.status),
      updatedAt: str(row.updated_at) || null,
      items: num(row.total_rows),
      open: `/w/${slug}/products-visualizer?project=${str(row.id)}`,
    }),
  },
  classify: {
    table: "image_classification_sessions",
    columns: "id, name, status, total_images, updated_at",
    toProject: (row, slug) => ({
      id: str(row.id),
      name: str(row.name),
      status: str(row.status),
      updatedAt: str(row.updated_at) || null,
      items: num(row.total_images),
      open: `/w/${slug}/image-classify/${str(row.id)}`,
    }),
  },
  website: {
    table: "wr_projects",
    columns: "id, name, status, phase, updated_at",
    toProject: (row, slug) => ({
      id: str(row.id),
      name: str(row.name),
      status: str(row.status),
      updatedAt: str(row.updated_at) || null,
      phase: str(row.phase) || undefined,
      open: `/w/${slug}/website-restructure`,
      select: `website.project.${str(row.id)}`,
    }),
  },
};

async function listFrom(supabase: SupabaseClient, source: Source, workspaceId: string, slug: string, limit: number) {
  const { data, error } = await supabase
    .from(source.table)
    .select(source.columns)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit + 1);
  if (error) return { error: "Could not read these projects." };
  const rows = (data ?? []) as unknown as Row[];
  return {
    projects: rows.slice(0, limit).map((row) => source.toProject(row, slug)),
    more: rows.length > limit,
  };
}

/** Store Assistant has no projects: it works on the one connected store. */
async function storeConnection(supabase: SupabaseClient, workspaceId: string, slug: string) {
  const { data, error } = await supabase
    .from("workspace_integrations")
    .select("id, integration_name, provider, status, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) return { error: "Could not read the store connection." };
  if (!data) return { projects: [], more: false };
  const row = data as Row;
  return {
    projects: [
      {
        id: str(row.id),
        name: str(row.integration_name) || str(row.provider),
        status: str(row.status),
        updatedAt: str(row.updated_at) || null,
        kind: str(row.provider) || undefined,
        open: `/w/${slug}/store-assistant`,
      },
    ],
    more: false,
  };
}

/**
 * The workspace's projects for the agent, read with the user's own session so
 * row-level security limits it to what the user can already see.
 */
export async function listAgentProjects(
  supabase: SupabaseClient,
  params: { workspaceId: string; workspaceSlug: string; tool?: ProjectTool }
): Promise<AgentProjectList> {
  const tools: ProjectTool[] = params.tool ? [params.tool] : ["catalog", "gallery", "visualizer", "classify", "website", "store"];
  const limit = params.tool ? PROJECTS_PER_TOOL.one : PROJECTS_PER_TOOL.all;
  const entries = await Promise.all(
    tools.map(async (tool) => {
      const result =
        tool === "store"
          ? await storeConnection(supabase, params.workspaceId, params.workspaceSlug)
          : await listFrom(supabase, SOURCES[tool], params.workspaceId, params.workspaceSlug, limit);
      return [tool, result] as const;
    })
  );
  return Object.fromEntries(entries);
}

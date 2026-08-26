import type { CategoryItem, SessionKind } from "@/types";
import { resolveEnabledColumns } from "./columns/registry";
import type { SpecContext } from "./columns/types";
import type { EnrichColumnConfig } from "./types";
import type { EnrichToolPolicy } from "./policy";

/**
 * Strict JSON schema covering only the columns requested in this run. Each
 * property is contributed by the column's own spec.
 */
export function buildEnrichJsonSchema(
  enabledColumns: string[],
  enrichmentColumns: EnrichColumnConfig[] | undefined,
  policy: EnrichToolPolicy,
  options?: {
    hasStoreCategoryAllowlist?: boolean;
    kind?: SessionKind;
    workspaceCategories?: CategoryItem[];
    cmsType?: string;
    language?: string;
  }
): { name: string; schema: Record<string, unknown> } {
  const kind: SessionKind = options?.kind ?? "product";
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const hasStoreAllowlist = options?.hasStoreCategoryAllowlist === true;

  for (const { id, col, spec } of resolveEnabledColumns(
    kind,
    enabledColumns,
    enrichmentColumns
  )) {
    const ctx: SpecContext = {
      kind,
      col,
      language: options?.language || "English",
      cmsType: options?.cmsType,
      workspaceCategories: options?.workspaceCategories,
      hasStoreAllowlist,
      rowData: {},
    };
    properties[id] = spec.buildSchemaProperty(ctx);
    required.push(id);
  }

  // Always allow a short notes field for debugging
  properties.notes = {
    type: "string",
    description:
      "Brief note on identity confidence and whether web search was used.",
  };
  required.push("notes");

  return {
    name: `import_${kind}_enrichment`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  };
}

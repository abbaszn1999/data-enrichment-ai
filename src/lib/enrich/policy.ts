import type { SessionKind } from "@/types";
import { resolveEnabledColumns } from "./columns/registry";
import type { ColumnNeeds } from "./columns/types";
import type { EnrichColumnConfig } from "./types";

export type EnrichToolChoice = "auto" | "required";
export type EnrichSearchContentType = "text" | "image";

export interface EnrichToolPolicy {
  needsImages: boolean;
  needsSources: boolean;
  needsCategories: boolean;
  textColumnIds: string[];
  toolChoice: EnrichToolChoice;
  searchContentTypes: EnrichSearchContentType[];
  imageCount: number;
  sourceCount: number;
  includeResults: boolean;
  includeSources: boolean;
}

/**
 * Derive Responses `web_search` tool settings by reducing over the `needs` of
 * every enabled column. A column that declares `search` forces the tool;
 * text-only runs stay on "auto" so the model can skip searching when the row
 * already identifies its subject.
 */
export function buildEnrichToolPolicy(
  enabledColumns: string[],
  enrichmentColumns?: EnrichColumnConfig[],
  kind: SessionKind = "product"
): EnrichToolPolicy {
  const resolved = resolveEnabledColumns(kind, enabledColumns, enrichmentColumns);

  const needs: Required<ColumnNeeds> = {
    search: false,
    images: false,
    sources: false,
    categoryAllowlist: false,
  };
  const textColumnIds: string[] = [];
  let imageCount = 3;
  let sourceCount = 3;

  for (const { id, col, spec } of resolved) {
    const columnNeeds = spec.needs ?? {};
    needs.search = needs.search || columnNeeds.search === true;
    needs.images = needs.images || columnNeeds.images === true;
    needs.sources = needs.sources || columnNeeds.sources === true;
    needs.categoryAllowlist =
      needs.categoryAllowlist || columnNeeds.categoryAllowlist === true;

    if (columnNeeds.images) {
      imageCount = Math.min(10, Math.max(1, col.imageCount ?? 3));
    }
    if (columnNeeds.sources) {
      sourceCount = Math.min(10, Math.max(1, col.sourceCount ?? 3));
    }
    if (!columnNeeds.images && !columnNeeds.sources && !columnNeeds.categoryAllowlist) {
      textColumnIds.push(id);
    }
  }

  // PLP pages are fronted by curated banners, not web packshots.
  const needsImages = kind === "plp" ? false : needs.images;

  return {
    needsImages,
    needsSources: needs.sources,
    needsCategories: needs.categoryAllowlist,
    textColumnIds,
    toolChoice: needs.search ? "required" : "auto",
    searchContentTypes: needsImages ? ["image", "text"] : ["text"],
    imageCount,
    sourceCount,
    includeResults: needsImages,
    includeSources: needs.sources,
  };
}

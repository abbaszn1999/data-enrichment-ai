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

const SPECIAL_IDS = new Set(["imageUrls", "sourceUrls", "categories"]);

function columnById(
  columns: EnrichColumnConfig[] | undefined,
  id: string
): EnrichColumnConfig | undefined {
  return columns?.find((c) => c.id === id);
}

/**
 * Derive Responses `web_search` tool settings from the enabled column set.
 * Images / sources force search; text-only uses auto so the model can skip
 * when product identity is already clear.
 */
export function buildEnrichToolPolicy(
  enabledColumns: string[],
  enrichmentColumns?: EnrichColumnConfig[]
): EnrichToolPolicy {
  const enabled = enabledColumns.filter(Boolean);
  const needsImages = enabled.includes("imageUrls");
  const needsSources = enabled.includes("sourceUrls");
  const needsCategories = enabled.includes("categories");
  const textColumnIds = enabled.filter((id) => !SPECIAL_IDS.has(id));

  const imageCol = columnById(enrichmentColumns, "imageUrls");
  const sourceCol = columnById(enrichmentColumns, "sourceUrls");
  const imageCount = Math.min(10, Math.max(1, imageCol?.imageCount ?? 3));
  const sourceCount = Math.min(10, Math.max(1, sourceCol?.sourceCount ?? 3));

  const forceSearch = needsImages || needsSources;
  const toolChoice: EnrichToolChoice = forceSearch ? "required" : "auto";

  const searchContentTypes: EnrichSearchContentType[] = needsImages
    ? ["image", "text"]
    : ["text"];

  return {
    needsImages,
    needsSources,
    needsCategories,
    textColumnIds,
    toolChoice,
    searchContentTypes,
    imageCount,
    sourceCount,
    includeResults: needsImages,
    includeSources: needsSources,
  };
}

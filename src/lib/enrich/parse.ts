import type { CategoryItem, EnrichedData, SessionKind } from "@/types";
import { resolveEnabledColumns } from "./columns/registry";
import type { SpecContext } from "./columns/types";
import type { EnrichColumnConfig, OpenAiResponse } from "./types";
import { collectToolImages, collectToolSources } from "./tool-results";
import { rawAnswerText } from "./columns/shared/helpers";
import { collapseHtmlList } from "@/lib/html-detect";
import { CITATION_SAFE_COLUMNS, stripCitations } from "./strip-citations";

// Tool-result helpers live in ./tool-results; re-exported here because other
// agents (sync, market-research) and tests import them from this module.
export {
  collectToolImages,
  collectToolSources,
  countWebSearchCalls,
  looksLikeDirectImageUrl,
  pickImagesFromSelection,
} from "./tool-results";

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export function responseOutputText(response: OpenAiResponse): string {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("\n");
}

function isEmptyColumnValue(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** The model's answer as written: a list stays a list (HTML collapses to one string), anything else is text. */
function keepAnswerAsWritten(raw: unknown): string | string[] {
  if (Array.isArray(raw)) {
    const items = raw.map((item) => rawAnswerText(item)).filter(Boolean);
    return collapseHtmlList(items);
  }
  return rawAnswerText(raw);
}

/**
 * Merge the model's JSON answer with validated tool images/sources into
 * EnrichedData, delegating each column to its own spec.
 */
export function buildEnrichedData(params: {
  selection: Record<string, unknown> | null;
  response: OpenAiResponse;
  enabledColumns: string[];
  enrichmentColumns?: EnrichColumnConfig[];
  kind?: SessionKind;
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
  cmsType?: string;
  maxCategories?: number;
  rowData?: Record<string, string>;
  language?: string;
}): EnrichedData {
  const { selection, response, enabledColumns } = params;
  const kind: SessionKind = params.kind ?? "product";
  const data: EnrichedData = {};
  const toolImages = collectToolImages(response);
  const toolSources = collectToolSources(response);
  const hasStoreAllowlist = (params.workspaceCategories?.length ?? 0) > 0;

  for (const { id, col, spec } of resolveEnabledColumns(
    kind,
    enabledColumns,
    params.enrichmentColumns
  )) {
    // Legacy callers pass maxCategories out of band rather than on the column.
    const resolvedCol: EnrichColumnConfig =
      id === "categories" && params.maxCategories != null
        ? { ...col, maxCategories: col.maxCategories ?? params.maxCategories }
        : col;

    const ctx: SpecContext = {
      kind,
      col: resolvedCol,
      language: params.language || "English",
      cmsType: params.cmsType,
      workspaceCategories: params.workspaceCategories,
      categoriesRawRows: params.categoriesRawRows,
      hasStoreAllowlist,
      rowData: params.rowData ?? {},
      selection: selection ?? undefined,
      toolImages,
      toolSources,
    };

    const rawAnswer = CITATION_SAFE_COLUMNS.has(id)
      ? selection?.[id]
      : stripCitations(selection?.[id]);
    let value = spec.parseValue(rawAnswer, ctx);
    const answered = rawAnswerText(rawAnswer) !== "";
    if (answered && isEmptyColumnValue(value)) {
      if (spec.preserveRawAnswer) {
        // The model wrote an answer its column parser could not use: keep it as
        // written rather than leaving a paid-for cell empty.
        console.warn("[Enrich] Column parser emptied an answer; kept it as written", { column: id });
        value = keepAnswerAsWritten(rawAnswer);
      } else {
        console.warn("[Enrich] Column answer was discarded by validation", { column: id });
      }
    }
    data[id] = value;
  }

  return data;
}

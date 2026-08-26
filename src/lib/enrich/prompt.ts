import type { CategoryItem, SessionKind } from "@/types";
import { resolveEnabledColumns } from "./columns/registry";
import type { SpecContext } from "./columns/types";
import type { EnrichColumnConfig, EnrichSettings } from "./types";
import type { EnrichToolPolicy } from "./policy";
import {
  GROUNDING_RULES,
  formatRowData,
  outputContract,
} from "./prompts/shared";
import {
  PRODUCT_DATA_HEADING,
  PRODUCT_IDENTITY_RULES,
  PRODUCT_ROLE,
} from "./prompts/product";
import {
  PLP_CONSTRAINT_RULES,
  PLP_DATA_HEADING,
  PLP_ROLE,
  PLP_ROLE_RULES,
  PLP_SEARCH_RULES,
} from "./prompts/plp";

function kindPreamble(
  kind: SessionKind,
  needsSearch: boolean
): { role: string; rules: string[]; dataHeading: string } {
  if (kind === "plp") {
    return {
      role: PLP_ROLE,
      rules: [
        ...PLP_ROLE_RULES,
        "",
        ...PLP_CONSTRAINT_RULES,
        ...(needsSearch ? ["", ...PLP_SEARCH_RULES] : []),
      ],
      dataHeading: PLP_DATA_HEADING,
    };
  }
  return {
    role: PRODUCT_ROLE,
    rules: PRODUCT_IDENTITY_RULES,
    dataHeading: PRODUCT_DATA_HEADING,
  };
}

/**
 * Assemble the enrich prompt: shared contract, kind-specific framing, then one
 * section per enabled column contributed by that column's own spec.
 */
export function buildEnrichPrompt(params: {
  productData: Record<string, string>;
  enabledColumns: string[];
  enrichmentColumns?: EnrichColumnConfig[];
  settings?: EnrichSettings;
  policy: EnrichToolPolicy;
  kind?: SessionKind;
  cmsType?: string;
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
}): { text: string; imageUrls: string[] } {
  const kind: SessionKind = params.kind ?? "product";
  const language = params.settings?.outputLanguage || "English";
  const { textBlock, imageUrls } = formatRowData(params.productData);
  const hasStoreAllowlist = (params.workspaceCategories?.length ?? 0) > 0;

  const makeContext = (col: EnrichColumnConfig): SpecContext => ({
    kind,
    col,
    language,
    cmsType: params.cmsType,
    workspaceCategories: params.workspaceCategories,
    categoriesRawRows: params.categoriesRawRows,
    hasStoreAllowlist,
    rowData: params.productData,
  });

  const resolved = resolveEnabledColumns(
    kind,
    params.enabledColumns,
    params.enrichmentColumns
  );

  const columnSections: string[] = [];
  const appendices: string[] = [];

  for (const { col, spec } of resolved) {
    const ctx = makeContext(col);
    const section = spec.buildPromptSection(ctx);
    if (section) columnSections.push(section);
    const appendix = spec.buildPromptAppendix?.(ctx);
    if (appendix) appendices.push(appendix);
  }

  const preamble = kindPreamble(kind, params.policy.toolChoice === "required");

  const sections = [
    [
      preamble.role,
      ...outputContract(language),
      "",
      ...preamble.rules,
      ...GROUNDING_RULES.map((r) => `- ${r}`),
    ].join("\n"),
    "",
    "Columns to fill:",
    columnSections.join("\n"),
    "",
    preamble.dataHeading,
    textBlock,
  ];

  for (const appendix of appendices) {
    sections.push("", appendix);
  }

  return { text: sections.join("\n"), imageUrls };
}

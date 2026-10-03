import type { CategoryItem, SessionKind } from "@/types";
import { resolveEnabledColumns } from "./columns/registry";
import type { SpecContext } from "./columns/types";
import type { EnrichColumnConfig, EnrichSettings } from "./types";
import type { EnrichToolPolicy } from "./policy";
import {
  AGENT_SKILLS,
  GROUNDING_RULES,
  HOW_TO_READ_INPUT,
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

function kindPreamble(kind: SessionKind): { role: string; rules: string[]; dataHeading: string } {
  if (kind === "plp") {
    return {
      role: PLP_ROLE,
      // Web search is always on for Enrich runs, so the search rules always apply.
      rules: [...PLP_ROLE_RULES, "", ...PLP_CONSTRAINT_RULES, "", ...PLP_SEARCH_RULES],
      dataHeading: PLP_DATA_HEADING,
    };
  }
  return {
    role: PRODUCT_ROLE,
    rules: PRODUCT_IDENTITY_RULES,
    dataHeading: PRODUCT_DATA_HEADING,
  };
}

export interface EnrichPrompt {
  /**
   * Everything that is identical for every row of a run (role, skills,
   * language, rules, the numbered columns with their custom instructions,
   * reference material). Sent as the Responses `instructions` so OpenAI's
   * prompt cache makes the repeated part cheap.
   */
  instructions: string;
  /** The per-row part: heading + the row's fields. */
  text: string;
  /** Images to attach to the row: pasted data-URIs / image URLs found in fields plus `sourceImageUrls`. */
  imageUrls: string[];
  /**
   * The same row text for a call that ends up with no picture (every image link
   * was dead): it never claims an image is attached. Only set when `imageUrls`
   * is not empty.
   */
  textWithoutImages?: string;
}

/** Row values that stand for pictures sent alongside the text ("[2 images attached]", a pasted image). */
const IMAGE_PLACEHOLDER_RE = /^\[\d+ images? attached\]$/i;
const IMAGES_UNAVAILABLE_VALUE = "[image could not be loaded]";
export const NO_IMAGES_NOTICE =
  "The product image for this row could not be loaded, so no image is attached. Identify the product from the fields above and web search only.";

/** Max product images sent with one row. */
export const MAX_ROW_IMAGES = 8;

/**
 * Assemble the enrich prompt: a stable `instructions` block (contract, kind
 * framing, one section per enabled column contributed by that column's own
 * spec) and a per-row `text`.
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
  /** Images from selected image columns (e.g. Image Finder output), attached as vision input. */
  sourceImageUrls?: string[];
}): EnrichPrompt {
  const kind: SessionKind = params.kind ?? "product";
  const language = params.settings?.outputLanguage || "English";
  const { textBlock, imageUrls: inlineImages } = formatRowData(params.productData);
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

  const resolved = resolveEnabledColumns(kind, params.enabledColumns, params.enrichmentColumns);

  const columnSections: string[] = [];
  const appendices: string[] = [];

  for (const { col, spec } of resolved) {
    const ctx = makeContext(col);
    const section = spec.buildPromptSection(ctx);
    if (section) columnSections.push(section);
    const appendix = spec.buildPromptAppendix?.(ctx);
    if (appendix) appendices.push(appendix);
  }

  const preamble = kindPreamble(kind);

  const globalInstruction = params.settings?.globalInstruction?.trim();

  const instructionSections = [
    [
      preamble.role,
      ...AGENT_SKILLS,
      "",
      ...outputContract(language),
      "",
      ...HOW_TO_READ_INPUT,
      "",
      ...preamble.rules,
      ...GROUNDING_RULES.map((r) => `- ${r}`),
    ].join("\n"),
    ...(globalInstruction
      ? [
          "",
          "Owner's instruction for all columns (the owner's method for this sheet, including how to research the item. Follow it exactly; it outranks the default method above. A column's own custom instruction wins if the two conflict. Its only limit is the grounding rules):",
          globalInstruction,
        ]
      : []),
    "",
    `Columns to fill (${columnSections.length}):`,
    columnSections.join("\n"),
  ];
  for (const appendix of appendices) {
    instructionSections.push("", appendix);
  }

  const imageUrls: string[] = [];
  const seen = new Set<string>();
  for (const url of [...inlineImages, ...(params.sourceImageUrls ?? [])]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    imageUrls.push(url);
    if (imageUrls.length >= MAX_ROW_IMAGES) break;
  }

  const rowSections = [preamble.dataHeading, textBlock];
  if (imageUrls.length > 0) {
    rowSections.push(
      "",
      `${imageUrls.length} product image${imageUrls.length === 1 ? " is" : "s are"} attached. Use ${
        imageUrls.length === 1 ? "it" : "them"
      } to identify the product, read its visible details, and help your web research find the exact item.`
    );
  }

  let textWithoutImages: string | undefined;
  if (imageUrls.length > 0) {
    const withoutPictures = Object.fromEntries(
      Object.entries(params.productData).map(([key, value]) => {
        const text = String(value ?? "").trim();
        return [key, IMAGE_PLACEHOLDER_RE.test(text) || text.startsWith("data:image/") ? IMAGES_UNAVAILABLE_VALUE : value];
      })
    );
    textWithoutImages = [preamble.dataHeading, formatRowData(withoutPictures).textBlock, "", NO_IMAGES_NOTICE].join("\n");
  }

  return {
    instructions: instructionSections.join("\n"),
    text: rowSections.join("\n"),
    imageUrls,
    ...(textWithoutImages ? { textWithoutImages } : {}),
  };
}

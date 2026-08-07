import {
  CMS_CATEGORY_CONFIG,
  DEFAULT_CMS_CATEGORY_CONFIG,
  type CategoryItem,
} from "@/types";
import type { EnrichColumnConfig, EnrichSettings } from "./types";
import type { EnrichToolPolicy } from "./policy";

function formatProductData(productData: Record<string, string>): {
  textBlock: string;
  imageRefs: Array<{ key: string; url: string }>;
} {
  const lines: string[] = [];
  const imageRefs: Array<{ key: string; url: string }> = [];

  for (const [key, raw] of Object.entries(productData)) {
    const value = String(raw ?? "").trim();
    if (!value) continue;

    if (value.startsWith("data:image/")) {
      lines.push(`- ${key}: [attached product image]`);
      imageRefs.push({ key, url: value });
      continue;
    }
    if (/^https?:\/\//i.test(value) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(value)) {
      lines.push(`- ${key}: [product image URL] ${value.slice(0, 200)}`);
      imageRefs.push({ key, url: value });
      continue;
    }
    lines.push(`- ${key}: ${value.slice(0, 1200)}`);
  }

  return { textBlock: lines.join("\n") || "(no product fields)", imageRefs };
}

function formatCategories(
  workspaceCategories: CategoryItem[] | undefined,
  categoriesRawRows: Record<string, string>[] | undefined,
  cmsType: string | undefined,
  maxCategories: number
): string {
  const cmsKey = (cmsType || "").toLowerCase();
  const cms =
    CMS_CATEGORY_CONFIG[cmsKey] || DEFAULT_CMS_CATEGORY_CONFIG;

  const parts: string[] = [
    `CMS type: ${cmsType || "generic"}`,
    `Column name: ${cms.columnName}`,
    `Hierarchy separator: "${cms.hierarchySeparator}"`,
    `Multi separator: "${cms.multiCategorySeparator}"`,
    `Supports multiple: ${cms.supportsMultiple}`,
    `Supports hierarchy: ${cms.supportsHierarchy}`,
    `Notes: ${cms.notes}`,
    `Assign at most ${maxCategories} categories.`,
  ];

  if (workspaceCategories && workspaceCategories.length > 0) {
    const listed = workspaceCategories
      .slice(0, 400)
      .map((c) => `- ${c.fullPath || c.name}`)
      .join("\n");
    parts.push(
      [
        "STORE CATEGORY ALLOWLIST (mandatory):",
        "You MUST pick ONLY from the list below — copy the path/name EXACTLY.",
        "If nothing in the list is a reasonable match for this product, return an EMPTY string for categories.",
        "Do NOT invent Shopify Standard Taxonomy, industry taxonomies, or any path not listed.",
        "Do NOT invent Baby/Electronics/etc. trees that are absent from the list.",
        "",
        listed,
      ].join("\n")
    );
  } else if (categoriesRawRows && categoriesRawRows.length > 0) {
    parts.push(
      [
        "Category sheet sample rows (JSON) — prefer values that appear here.",
        "If nothing fits, return an empty categories string.",
        JSON.stringify(categoriesRawRows.slice(0, 40)).slice(0, 6000),
      ].join("\n")
    );
  } else {
    parts.push(
      "No store category list provided — suggest industry-standard categories using CMS formatting."
    );
  }

  return parts.join("\n");
}

function columnInstructions(
  enabledColumns: string[],
  enrichmentColumns: EnrichColumnConfig[] | undefined
): string {
  const byId = new Map((enrichmentColumns || []).map((c) => [c.id, c]));
  return enabledColumns
    .map((id) => {
      const col = byId.get(id);
      const tone = col?.writingTone ? ` tone=${col.writingTone}` : "";
      const length = col?.contentLength ? ` length=${col.contentLength}` : "";
      const custom = col?.customInstruction?.trim()
        ? `\n  Extra: ${col.customInstruction.trim()}`
        : "";
      return `- ${id} (${col?.label || id})${tone}${length}: ${
        col?.description || "Fill accurately from product data and search."
      }${custom}`;
    })
    .join("\n");
}

export function buildEnrichPrompt(params: {
  productData: Record<string, string>;
  enabledColumns: string[];
  enrichmentColumns?: EnrichColumnConfig[];
  settings?: EnrichSettings;
  policy: EnrichToolPolicy;
  cmsType?: string;
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
}): { text: string; imageUrls: string[] } {
  const { textBlock, imageRefs } = formatProductData(params.productData);
  const language = params.settings?.outputLanguage || "English";
  const catCol = params.enrichmentColumns?.find((c) => c.id === "categories");
  const maxCats = catCol?.maxCategories ?? 3;
  const hasStoreList = (params.workspaceCategories?.length ?? 0) > 0;

  const searchRules: string[] = [
    "You enrich ONE ecommerce product for Import AI.",
    "Return ONLY the JSON schema fields requested.",
    `Write all user-facing text in: ${language}.`,
    "",
    "Identity / web search rules:",
    "- If brand+model, clear title+type, barcode, or rich description clearly identify the product, you may skip web search for text/categories (images/sources still follow their own rules).",
    "- If identity is weak (SKU-only, cryptic codes, conflicting fields), you MUST use web_search before writing factual fields.",
  ];

  if (params.policy.needsSources) {
    searchRules.push(
      "- sourceUrls are required: always use web_search; only cite real result URLs/titles."
    );
  }
  if (params.policy.needsImages) {
    searchRules.push(
      `- imageUrls are required: always use web_search with image results; pick up to ${params.policy.imageCount} exact-product images.`,
      "- Prefer official brand / manufacturer / reputable retailer packshots.",
      "- CRITICAL: imageUrls must be the tool field image_url ONLY (direct image file URLs).",
      "- NEVER put source_website_url, retailer product pages, or HTML catalogue links into imageUrls.",
      "- Never invent image URLs; select only from web_search image_result.image_url values."
    );
  }
  if (params.policy.needsCategories) {
    if (hasStoreList) {
      searchRules.push(
        "- categories: ONLY exact values from the store allowlist below. If none fit, return \"\"."
      );
    } else {
      searchRules.push(
        "- categories: follow CMS formatting; do not invent unrelated taxonomies."
      );
    }
  }

  searchRules.push(
    "- Never invent specifications, certifications, or claims not supported by row data or search.",
    "- Prefer manufacturer / official pages when sources conflict."
  );

  const sections = [
    searchRules.join("\n"),
    "",
    "Columns to fill:",
    columnInstructions(params.enabledColumns, params.enrichmentColumns),
    "",
    "Product data:",
    textBlock,
  ];

  if (params.policy.needsCategories) {
    sections.push(
      "",
      "Category rules:",
      formatCategories(
        params.workspaceCategories,
        params.categoriesRawRows,
        params.cmsType,
        maxCats
      )
    );
  }

  return {
    text: sections.join("\n"),
    imageUrls: imageRefs.map((r) => r.url).slice(0, 4),
  };
}

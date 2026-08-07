import type { EnrichColumnConfig } from "./types";
import type { EnrichToolPolicy } from "./policy";

function textProperty(col: EnrichColumnConfig): Record<string, unknown> {
  return {
    type: "string",
    description:
      col.customInstruction?.trim() ||
      col.description ||
      `Value for ${col.label}`,
  };
}

function listProperty(col: EnrichColumnConfig): Record<string, unknown> {
  return {
    type: "array",
    description:
      col.customInstruction?.trim() ||
      col.description ||
      `List values for ${col.label}`,
    items: { type: "string" },
  };
}

function imageUrlsProperty(limit: number): Record<string, unknown> {
  return {
    type: "array",
    description:
      "Direct image file URLs only — copy image_url values from web_search image_result items. Never use source_website_url, HTML product pages, or invented URLs.",
    items: { type: "string" },
    maxItems: limit,
  };
}

function sourceUrlsProperty(limit: number): Record<string, unknown> {
  return {
    type: "array",
    description:
      "Authoritative source pages from web search citations/sources only. Do not invent URLs.",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        uri: { type: "string" },
      },
      required: ["title", "uri"],
    },
    maxItems: limit,
  };
}

function categoriesProperty(
  col: EnrichColumnConfig | undefined,
  hasStoreAllowlist: boolean
): Record<string, unknown> {
  const max = Math.min(5, Math.max(1, col?.maxCategories ?? 3));
  const base =
    col?.customInstruction?.trim() ||
    col?.description ||
    `Assign up to ${max} categories using the CMS formatting rules provided.`;
  return {
    type: "string",
    description: hasStoreAllowlist
      ? `${base} MUST be an exact allowlist value, or empty string if none fit.`
      : base,
  };
}

/**
 * Strict JSON schema for only the columns requested in this enrich run.
 */
export function buildEnrichJsonSchema(
  enabledColumns: string[],
  enrichmentColumns: EnrichColumnConfig[] | undefined,
  policy: EnrichToolPolicy,
  options?: { hasStoreCategoryAllowlist?: boolean }
): { name: string; schema: Record<string, unknown> } {
  const byId = new Map((enrichmentColumns || []).map((c) => [c.id, c]));
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const hasStoreAllowlist = options?.hasStoreCategoryAllowlist === true;

  for (const id of enabledColumns) {
    const col = byId.get(id);
    const type = col?.type;

    if (id === "imageUrls" || type === "imageUrls") {
      properties[id] = imageUrlsProperty(policy.imageCount);
      required.push(id);
      continue;
    }
    if (id === "sourceUrls" || type === "sourceUrls") {
      properties[id] = sourceUrlsProperty(policy.sourceCount);
      required.push(id);
      continue;
    }
    if (id === "categories" || type === "categories") {
      properties[id] = categoriesProperty(col, hasStoreAllowlist);
      required.push(id);
      continue;
    }
    if (type === "list") {
      properties[id] = listProperty(
        col || {
          id,
          label: id,
          description: `List for ${id}`,
          type: "list",
          enabled: true,
        }
      );
      required.push(id);
      continue;
    }

    properties[id] = textProperty(
      col || {
        id,
        label: id,
        description: `Value for ${id}`,
        type: "text",
        enabled: true,
      }
    );
    required.push(id);
  }

  // Always allow a short notes field for debugging (optional in schema via required list)
  properties.notes = {
    type: "string",
    description: "Brief note on identity confidence and whether web search was used.",
  };
  required.push("notes");

  return {
    name: "import_product_enrichment",
    schema: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  };
}

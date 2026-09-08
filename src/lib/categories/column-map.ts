import { CMS_CATEGORY_COLUMNS, type CmsCategoryColumns } from "@/types";

export type CategorySheetMapping = {
  name: string;
  parent: string;
  description: string;
  id: string;
};

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function normalizeHeader(value: string): string {
  return stripBom(value)
    .toLowerCase()
    .trim()
    .replace(/[\s_\-()]+/g, "");
}

const GENERIC_FALLBACK: CmsCategoryColumns = {
  nameColumns: [
    "title",
    "name",
    "category_name",
    "collection",
    "الاسم",
    "اسم التصنيف",
  ],
  parentColumns: [
    "parent_id",
    "parent_collection",
    "parent",
    "parent_category_id",
  ],
  descColumns: ["body (html)", "body_html", "description", "desc", "الوصف"],
  idColumns: ["handle", "category_id", "entity_id", "id"],
  hint: "",
};

/**
 * Return the actual sheet header that matches a list of synonyms.
 * Never returns the synonym itself — that is what skipped Shopify `Title`
 * rows when the UI stored `"title"`.
 */
export function matchSheetColumn(
  columns: string[],
  candidates: string[]
): string {
  for (const candidate of candidates) {
    const exact = columns.find(
      (col) => stripBom(col).toLowerCase() === candidate.toLowerCase()
    );
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const needle = normalizeHeader(candidate);
    if (!needle) continue;
    const normalized = columns.find((col) => normalizeHeader(col) === needle);
    if (normalized) return normalized;
  }

  // Substring match only for longer names so "id" does not hit "Handle".
  for (const candidate of candidates) {
    if (candidate.trim().length < 4) continue;
    const lower = candidate.toLowerCase();
    const hit = columns.find((col) =>
      stripBom(col).toLowerCase().includes(lower)
    );
    if (hit) return hit;
  }

  return "";
}

export function suggestCategoryColumnMap(
  columns: string[],
  cms: CmsCategoryColumns
): CategorySheetMapping {
  const used = new Set<string>();
  const take = (candidates: string[]) => {
    const matched = matchSheetColumn(columns, candidates);
    if (!matched || used.has(matched)) return "";
    used.add(matched);
    return matched;
  };

  const mapped: CategorySheetMapping = {
    name: take(cms.nameColumns),
    parent: take(cms.parentColumns),
    description: take(cms.descColumns),
    id: take(cms.idColumns),
  };

  for (const extra of [
    CMS_CATEGORY_COLUMNS.shopify,
    CMS_CATEGORY_COLUMNS.custom,
    GENERIC_FALLBACK,
  ]) {
    if (!mapped.name) mapped.name = take(extra.nameColumns);
    if (!mapped.parent) mapped.parent = take(extra.parentColumns);
    if (!mapped.description) mapped.description = take(extra.descColumns);
    if (!mapped.id) mapped.id = take(extra.idColumns);
  }

  return mapped;
}

export function columnSampleValues(
  rows: Record<string, string>[],
  column: string,
  limit = 2
): string[] {
  if (!column) return [];
  const samples: string[] = [];
  for (const row of rows) {
    const value = String(row[column] ?? "").trim();
    if (!value) continue;
    samples.push(value);
    if (samples.length >= limit) break;
  }
  return samples;
}

export function mappedNonEmptyCount(
  rows: Record<string, string>[],
  column: string
): number {
  if (!column) return 0;
  return rows.reduce((count, row) => {
    return String(row[column] ?? "").trim() ? count + 1 : count;
  }, 0);
}

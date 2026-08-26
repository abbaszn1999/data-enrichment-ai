/**
 * Writes PLP enrichment output back into categories.json, so a category page
 * carries its SEO copy without a round-trip through an export file.
 *
 * Rows are matched to stored categories with the same normalization the PLP
 * matching step uses, so "existing" rows here are exactly the ones the
 * workspace flagged as existing.
 */
import {
  loadCategoriesJson,
  saveCategoriesJson,
  type CategoryJson,
  type CategorySeoContent,
} from "@/lib/storage-helpers";
import { normalizeValue, type MatchingRule } from "@/lib/matching";
import { PLP_MATCHING_RULES } from "@/lib/import-matching";
import type { FaqItem, ProductRow } from "@/types";

const SEO_FIELDS = [
  "seoTitle",
  "metaDescription",
  "h1",
  "introCopy",
  "seoCopy",
  "targetKeyword",
  "secondaryKeywords",
  "faq",
  "internalLinks",
  "breadcrumbLabel",
] as const;

type SeoField = (typeof SEO_FIELDS)[number];

function normalize(value: string, rules: MatchingRule[]): string {
  return normalizeValue(value, rules).replace(/\/+$/, "");
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map((v) => String(v ?? "").trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function asFaq(value: unknown): FaqItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .filter(
      (v): v is FaqItem =>
        typeof v === "object" && v !== null && "question" in v && "answer" in v
    )
    .map((v) => ({
      question: String(v.question ?? "").trim(),
      answer: String(v.answer ?? "").trim(),
    }))
    .filter((v) => v.question !== "" && v.answer !== "");
  return list.length > 0 ? list : undefined;
}

/** Pulls only the recognised SEO fields off a row's enriched data. */
function seoFromRow(row: ProductRow, sessionId: string): CategorySeoContent | null {
  const seo: CategorySeoContent = {};
  let hasValue = false;

  for (const field of SEO_FIELDS as readonly SeoField[]) {
    const raw = row.enrichedData?.[field];
    if (raw === undefined || raw === null || raw === "") continue;

    if (field === "faq") {
      const faq = asFaq(raw);
      if (faq) {
        seo.faq = faq;
        hasValue = true;
      }
      continue;
    }

    if (field === "secondaryKeywords" || field === "internalLinks") {
      const list = asStringList(raw);
      if (list) {
        seo[field] = list;
        hasValue = true;
      }
      continue;
    }

    const text = String(raw).trim();
    if (text) {
      seo[field] = text;
      hasValue = true;
    }
  }

  if (!hasValue) return null;
  seo.updatedAt = new Date().toISOString();
  seo.sourceSessionId = sessionId;
  return seo;
}

/** Every value a stored category can be matched by, for the given master column. */
function categoryKeys(cat: CategoryJson, masterColumn: string): string[] {
  switch (masterColumn) {
    case "slug":
      return [cat.slug];
    case "url":
      return [cat.slug, `/${cat.slug}`];
    case "fullPath":
      return [cat.slug, cat.name];
    default:
      return [cat.name];
  }
}

export interface WriteBackResult {
  updated: number;
  /** Rows that carried SEO content but matched no stored category. */
  unmatched: number;
  /** Rows with no PLP output to write. */
  skipped: number;
}

/** Rows that actually carry PLP output, for the confirmation copy. */
export function countRowsWithPlpContent(rows: ProductRow[]): number {
  return rows.filter((row) => seoFromRow(row, "") !== null).length;
}

/** Merges PLP output into categories.json and persists it. */
export async function applyPlpWriteBack(params: {
  workspaceId: string;
  sessionId: string;
  rows: ProductRow[];
  sourceColumn: string;
  masterColumn?: string;
  rules?: MatchingRule[];
}): Promise<WriteBackResult> {
  const {
    workspaceId,
    sessionId,
    rows,
    sourceColumn,
    masterColumn = "name",
    rules = PLP_MATCHING_RULES,
  } = params;

  const categories = await loadCategoriesJson(workspaceId);
  if (categories.length === 0) {
    return { updated: 0, unmatched: rows.length, skipped: 0 };
  }

  const byKey = new Map<string, number>();
  categories.forEach((cat, index) => {
    for (const key of categoryKeys(cat, masterColumn)) {
      const value = String(key ?? "").trim();
      if (!value) continue;
      const norm = normalize(value, rules);
      if (norm && !byKey.has(norm)) byKey.set(norm, index);
    }
  });

  const touched = new Set<number>();
  let unmatched = 0;
  let skipped = 0;

  for (const row of rows) {
    const seo = seoFromRow(row, sessionId);
    if (!seo) {
      skipped++;
      continue;
    }
    const raw = String(row.originalData?.[sourceColumn] ?? "").trim();
    const index = raw ? byKey.get(normalize(raw, rules)) : undefined;
    if (index === undefined) {
      unmatched++;
      continue;
    }
    // Merge so a partial run never wipes SEO copy written by an earlier one.
    categories[index] = {
      ...categories[index],
      seo: { ...categories[index].seo, ...seo },
    };
    touched.add(index);
  }

  if (touched.size > 0) {
    await saveCategoriesJson(workspaceId, categories);
  }

  return { updated: touched.size, unmatched, skipped };
}

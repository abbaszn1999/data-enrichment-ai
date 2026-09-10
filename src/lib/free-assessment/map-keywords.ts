import type { KeywordRow } from "./providers/keyword-provider";
import { isQuestionKeyword, sheetForIntents } from "./providers/semrush-codes";
import { wordCount } from "./filters";

export type DisplayKeyword = {
  id: string;
  seedId: string;
  seed: string;
  keyword: string;
  volume: number;
  difficulty: number;
  wordCount: number;
  isQuestion: boolean;
  sheet: "informational" | "category" | "excluded";
  productMatches: number;
  exclusionReason?: string;
  plpConcept?: string;
};


function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) % 100_000;
  }
  return h;
}

export function toExtractedKeyword(
  row: KeywordRow,
  seedId: string,
  index: number
): DisplayKeyword {
  return {
    id: `${seedId}-${index}-${hash(row.phrase)}`,
    seedId,
    seed: row.seed,
    keyword: row.phrase,
    volume: row.volume,
    difficulty: row.difficulty,
    wordCount: wordCount(row.phrase),
    isQuestion: isQuestionKeyword(row.phrase, row.intents),
    sheet: "category",
    productMatches: 0,
  };
}

/**
 * Hard safety ceiling on how many rows the client keeps in memory / persists
 * for a single project's extract. Every real pull (including duplicate
 * phrases pulled under different seeds — they're real, distinct rows the
 * merchant paid for) is kept as-is; this only guards against a truly
 * pathological pull size and should essentially never be hit in practice.
 */
export const MAX_DISPLAY_ROWS = 50_000;

/** Appends every newly pulled row exactly as returned — no cross-seed dedup. */
export function appendKeywordRows(
  existing: DisplayKeyword[],
  incoming: DisplayKeyword[]
): DisplayKeyword[] {
  if (incoming.length === 0 || existing.length >= MAX_DISPLAY_ROWS) {
    return existing;
  }
  const room = MAX_DISPLAY_ROWS - existing.length;
  return room >= incoming.length
    ? [...existing, ...incoming]
    : [...existing, ...incoming.slice(0, room)];
}

export type KeywordClassificationPatch = {
  keyword: string;
  sheet: DisplayKeyword["sheet"];
  reason?: string;
  plpConcept?: string;
};

/** Overlay Stage 4 verdicts onto display rows by keyword text (case-insensitive). */
export function applyKeywordClassifications<
  T extends {
    keyword: string;
    sheet: DisplayKeyword["sheet"];
    exclusionReason?: string;
    plpConcept?: string;
  },
>(rows: T[], patches: KeywordClassificationPatch[]): T[] {
  if (rows.length === 0 || patches.length === 0) return rows;
  const byText = new Map<string, KeywordClassificationPatch>();
  for (const patch of patches) {
    const key = patch.keyword.trim().toLowerCase();
    if (key) byText.set(key, patch);
  }
  if (byText.size === 0) return rows;
  return rows.map((row) => {
    const match = byText.get(row.keyword.trim().toLowerCase());
    if (!match) return row;
    return {
      ...row,
      sheet: match.sheet,
      exclusionReason: match.reason,
      plpConcept: match.plpConcept,
    };
  });
}

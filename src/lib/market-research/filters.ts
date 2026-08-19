import type { KeywordRow } from "./providers/keyword-provider";
import { sheetForIntents } from "./providers/semrush-codes";

export type KeywordFiltersInput = {
  minVolume?: number;
  maxKd?: number;
  excludedTerms?: string[];
  minWordCount?: number;
  maxWordCount?: number;
};

export function wordCount(phrase: string): number {
  return phrase.trim().split(/\s+/).filter(Boolean).length;
}

export function applyKeywordFilters(
  rows: KeywordRow[],
  filters: KeywordFiltersInput
): KeywordRow[] {
  const minVolume = Math.max(0, filters.minVolume ?? 0);
  const maxKd = filters.maxKd ?? 100;
  const minWords = Math.max(1, filters.minWordCount ?? 1);
  const maxWords = Math.max(minWords, filters.maxWordCount ?? 12);
  const excluded = (filters.excludedTerms ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  return rows.filter((row) => {
    if (row.volume < minVolume) return false;
    if (row.difficulty > maxKd) return false;
    const words = wordCount(row.phrase);
    if (words < minWords || words > maxWords) return false;
    if (excluded.length === 0) return true;
    const hay = row.phrase.toLowerCase();
    return !excluded.some((term) => hay.includes(term));
  });
}

export function splitKeywordSheets(rows: KeywordRow[]): {
  commercial: KeywordRow[];
  informational: KeywordRow[];
} {
  const commercial: KeywordRow[] = [];
  const informational: KeywordRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (sheetForIntents(row.intents) === "category") commercial.push(row);
    else informational.push(row);
  }
  return { commercial, informational };
}

import {
  DEFAULT_FILTERS,
  keywordPassesFilters,
  normalizeKeywordFilters,
  type KeywordFilters,
} from "@/components/market-research/workspace-data";
import { isQuestionKeyword } from "@/lib/market-research/providers/semrush-codes";
import type { ArchiveKeywordRow } from "@/lib/market-research/storage-admin";
import type { ClassifiedShardItem } from "@/lib/market-research/storage-admin";

function archiveRowForTerm(
  term: ClassifiedShardItem,
  byPhrase: Map<string, ArchiveKeywordRow>
): ArchiveKeywordRow | undefined {
  return (
    byPhrase.get(term.id.trim().toLowerCase()) ??
    byPhrase.get(term.keyword.trim().toLowerCase())
  );
}

export function archiveRowsByPhrase(
  rows: ArchiveKeywordRow[]
): Map<string, ArchiveKeywordRow> {
  const byPhrase = new Map<string, ArchiveKeywordRow>();
  for (const row of rows) {
    const key = row.phrase.trim().toLowerCase();
    const existing = byPhrase.get(key);
    if (!existing || (row.volume ?? 0) > (existing.volume ?? 0)) {
      byPhrase.set(key, row);
    }
  }
  return byPhrase;
}

/**
 * Apply the Extract-tab sheet filters to the full classified archive, using
 * volume / KD / question flags from the paid extract rows.
 */
export function filterClassifiedTerms<T extends ClassifiedShardItem>(
  terms: T[],
  archiveByPhrase: Map<string, ArchiveKeywordRow>,
  filters: KeywordFilters = DEFAULT_FILTERS
): T[] {
  const applied = normalizeKeywordFilters(filters);
  return terms.filter((term) => {
    const archive = archiveRowForTerm(term, archiveByPhrase);
    return keywordPassesFilters(
      {
        keyword: term.keyword,
        seed: archive?.seed ?? term.seedId,
        volume: archive?.volume ?? 0,
        difficulty: archive?.difficulty ?? 0,
        isQuestion: archive
          ? isQuestionKeyword(archive.phrase, archive.intents)
          : false,
      },
      applied
    );
  });
}

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

/** True when the extract archive has rows the UI cache never persisted. */
export function keywordSampleNeedsRebuild(
  storedCount: number,
  archiveCount: number
): boolean {
  return archiveCount > Math.max(0, Math.floor(storedCount) || 0);
}

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
  id?: string;
};

/** One Stage 4 classified-archive row (or a Gemini log item). */
export type ClassifiedVerdict = {
  id?: string;
  keyword?: string;
  sheet: DisplayKeyword["sheet"];
  reason?: string;
  plpConcept?: string;
};

function classificationKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Join key is the phrase; Gemini sometimes puts that phrase in `id` instead. */
export function classifiedVerdictsToPatches(
  items: ClassifiedVerdict[]
): KeywordClassificationPatch[] {
  const patches: KeywordClassificationPatch[] = [];
  for (const item of items) {
    const keyword = (item.keyword || item.id || "").trim();
    if (!keyword || !item.sheet) continue;
    patches.push({
      id: item.id,
      keyword,
      sheet: item.sheet,
      reason: item.reason,
      plpConcept: item.plpConcept,
    });
  }
  return patches;
}

/**
 * Overlay Stage 4 verdicts onto display rows. Match by phrase first, then by
 * id — archive rows and the Extract sample do not share an id space, but
 * Gemini often echoes the phrase as `id`.
 */
export function applyKeywordClassifications<
  T extends {
    keyword: string;
    sheet: DisplayKeyword["sheet"];
    exclusionReason?: string;
    plpConcept?: string;
    id?: string;
  },
>(rows: T[], patches: KeywordClassificationPatch[]): T[] {
  if (rows.length === 0 || patches.length === 0) return rows;
  const byText = new Map<string, KeywordClassificationPatch>();
  for (const patch of patches) {
    const phrase = classificationKey(patch.keyword);
    const id = classificationKey(patch.id);
    if (phrase) byText.set(phrase, patch);
    if (id) byText.set(id, patch);
  }
  if (byText.size === 0) return rows;
  return rows.map((row) => {
    const match =
      byText.get(classificationKey(row.keyword)) ??
      byText.get(classificationKey(row.id));
    if (!match) return row;
    return {
      ...row,
      sheet: match.sheet,
      exclusionReason: match.reason,
      plpConcept: match.plpConcept,
    };
  });
}

/** Re-apply the classified archive onto an Extract sample. Classified wins. */
export function overlayKeywordSampleWithClassified<T extends {
  keyword: string;
  sheet: DisplayKeyword["sheet"];
  exclusionReason?: string;
  plpConcept?: string;
  id?: string;
}>(rows: T[], classified: ClassifiedVerdict[]): T[] {
  return applyKeywordClassifications(rows, classifiedVerdictsToPatches(classified));
}

export function keywordClassificationOverlayChanged<
  T extends {
    sheet: DisplayKeyword["sheet"];
    exclusionReason?: string;
    plpConcept?: string;
  },
>(before: T[], after: T[]): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < after.length; i += 1) {
    const prev = before[i]!;
    const next = after[i]!;
    if (prev.sheet !== next.sheet) return true;
    if ((prev.exclusionReason ?? "") !== (next.exclusionReason ?? "")) return true;
    if ((prev.plpConcept ?? "") !== (next.plpConcept ?? "")) return true;
  }
  return false;
}

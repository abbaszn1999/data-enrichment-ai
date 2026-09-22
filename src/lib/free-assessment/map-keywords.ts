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
  /**
   * True when this row's `sheet` came from a real Gemini verdict; false
   * means the regex heuristic fallback was used. Undefined means no
   * classification has overlaid this row yet (still the extract default).
   */
  isAiGenerated?: boolean;
  /**
   * Set when this row was removed as the exact same search as another
   * category term. The value is the keyword that was kept (highest volume).
   */
  sameIntentOf?: string;
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
  /** True = real Gemini verdict, false = heuristic fallback, undefined = unknown/legacy. */
  isAiGenerated?: boolean;
};

/** One Stage 4 classified-archive row (or a Gemini log item). */
export type ClassifiedVerdict = {
  id?: string;
  keyword?: string;
  sheet: DisplayKeyword["sheet"];
  reason?: string;
  plpConcept?: string;
  isAiGenerated?: boolean;
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
      isAiGenerated: item.isAiGenerated,
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
    isAiGenerated?: boolean;
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
      isAiGenerated: match.isAiGenerated,
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
  isAiGenerated?: boolean;
}>(rows: T[], classified: ClassifiedVerdict[]): T[] {
  return applyKeywordClassifications(rows, classifiedVerdictsToPatches(classified));
}

function exactDisplayKey(keyword: string): string {
  return keyword.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

export type SameIntentDrop = {
  droppedKeyword: string;
  keptKeyword: string;
};

/**
 * Hide dropped category rows and, within a kept wording, keep only the
 * highest-volume row. Rows on other sheets are left unchanged. An empty
 * drop list clears a previous same-intent mark, then still collapses
 * identical category wording in the sample.
 */
export function applySameIntentOverlay<
  T extends {
    keyword: string;
    volume: number;
    sheet: DisplayKeyword["sheet"];
    sameIntentOf?: string;
  },
>(rows: T[], drops: SameIntentDrop[]): T[] {
  const droppedToKept = new Map<string, string>();
  for (const drop of drops) {
    const key = exactDisplayKey(drop.droppedKeyword);
    if (key) droppedToKept.set(key, drop.keptKeyword);
  }

  const marked = rows.map((row) => {
    if (row.sheet !== "category") {
      if (!row.sameIntentOf) return row;
      const { sameIntentOf: _removed, ...rest } = row;
      return rest as T;
    }
    const kept = droppedToKept.get(exactDisplayKey(row.keyword));
    if (!kept) {
      if (!row.sameIntentOf) return row;
      const { sameIntentOf: _removed, ...rest } = row;
      return rest as T;
    }
    return { ...row, sameIntentOf: kept };
  });

  const bestIndex = new Map<string, number>();
  marked.forEach((row, index) => {
    if (row.sheet !== "category" || row.sameIntentOf) return;
    const key = exactDisplayKey(row.keyword);
    const prev = bestIndex.get(key);
    if (prev === undefined) {
      bestIndex.set(key, index);
      return;
    }
    const prevRow = marked[prev]!;
    if (row.volume > prevRow.volume) bestIndex.set(key, index);
  });

  return marked.map((row, index) => {
    if (row.sheet !== "category" || row.sameIntentOf) return row;
    const winner = bestIndex.get(exactDisplayKey(row.keyword));
    if (winner === undefined || winner === index) return row;
    return { ...row, sameIntentOf: marked[winner]!.keyword };
  });
}

export function keywordClassificationOverlayChanged<
  T extends {
    sheet: DisplayKeyword["sheet"];
    exclusionReason?: string;
    plpConcept?: string;
    isAiGenerated?: boolean;
  },
>(before: T[], after: T[]): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < after.length; i += 1) {
    const prev = before[i]!;
    const next = after[i]!;
    if (prev.sheet !== next.sheet) return true;
    if ((prev.exclusionReason ?? "") !== (next.exclusionReason ?? "")) return true;
    if ((prev.plpConcept ?? "") !== (next.plpConcept ?? "")) return true;
    if (Boolean(prev.isAiGenerated) !== Boolean(next.isAiGenerated)) return true;
  }
  return false;
}

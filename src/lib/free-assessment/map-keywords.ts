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
  weight: number;
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
    weight: 1,
  };
}

export const SAMPLE_CAP = 1_500;

export function mergeKeywordSample(
  existing: DisplayKeyword[],
  incoming: DisplayKeyword[]
): DisplayKeyword[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((row) => row.keyword.toLowerCase()));
  const next = [...existing];
  for (const row of incoming) {
    const key = row.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(row);
    if (next.length >= SAMPLE_CAP) break;
  }
  return next;
}

export function applySampleWeights(
  sample: DisplayKeyword[],
  pulledBySeed: Record<string, number>
): DisplayKeyword[] {
  const sampleBySeed = new Map<string, number>();
  for (const row of sample) {
    sampleBySeed.set(row.seedId, (sampleBySeed.get(row.seedId) ?? 0) + 1);
  }
  return sample.map((row) => {
    const pulled = pulledBySeed[row.seedId] ?? sample.length;
    const shown = sampleBySeed.get(row.seedId) ?? 1;
    return {
      ...row,
      weight: Math.max(1, Math.round(pulled / Math.max(1, shown))),
    };
  });
}

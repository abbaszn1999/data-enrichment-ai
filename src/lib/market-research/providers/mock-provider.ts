import { EXTRACT_CAP_PER_SEED } from "../cost";
import type {
  KeywordDataProvider,
  KeywordRow,
  RelatedKeyword,
  SeedMetrics,
} from "./keyword-provider";
import { normalizeSeedTerm } from "./keyword-provider";
import type { SearchIntent } from "./semrush-codes";
import { sheetForIntents } from "./semrush-codes";

const MOCK_RAW: Record<string, number> = {
  sunglasses: 2400,
  "sun glasses": 1100,
  shades: 3200,
  eyewear: 48000,
  glasses: 39000,
  "women's sunglasses": 850,
  "sunglasses for women": 640,
  "ladies' sunglasses": 410,
  "women's eyewear": 5200,
  "women's glasses": 7400,
  toys: 26000,
  toy: 9100,
  playthings: 720,
  "kids' products": 18500,
  "children's toys": 6300,
  "educational toys": 2900,
  "learning toys": 1400,
  "board games": 8800,
  "tabletop games": 1900,
  "table games": 3100,
  "board game": 2600,
};

const CHUNK = 250;
const MOCK_DURATION_MS = 1_200;

type MockPayload = {
  seed: string;
  database: string;
  limitPerSeed: number;
  minVolume?: number;
  maxDifficulty?: number;
  startedAt: number;
};

function passesFilters(
  row: KeywordRow,
  minVolume?: number,
  maxDifficulty?: number
): boolean {
  if (typeof minVolume === "number" && minVolume > 0 && row.volume < minVolume) {
    return false;
  }
  if (
    typeof maxDifficulty === "number" &&
    maxDifficulty < 100 &&
    row.difficulty > maxDifficulty
  ) {
    return false;
  }
  return true;
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) % 100_000;
  }
  return h;
}

function rawFor(seed: string): number {
  const key = seed.toLowerCase();
  const base = MOCK_RAW[key] ?? 600 + (hash(key) % 2400);
  return Math.min(EXTRACT_CAP_PER_SEED, Math.max(80, base));
}

function encodeHandle(payload: MockPayload): string {
  return `mock:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function decodeHandle(runId: string): MockPayload | null {
  if (!runId.startsWith("mock:")) return null;
  try {
    return JSON.parse(
      Buffer.from(runId.slice(5), "base64url").toString("utf8")
    ) as MockPayload;
  } catch {
    return null;
  }
}

function intentsFor(index: number, phrase: string): SearchIntent[] {
  if (/^(how|what|why|are|is)\b|\?/.test(phrase)) return ["informational"];
  if (index % 11 === 0) return ["navigational"];
  if (index % 5 === 0) return ["commercial", "transactional"];
  if (index % 3 === 0) return ["commercial"];
  return ["transactional"];
}

const CATEGORY_PATTERNS = [
  "{s}",
  "buy {s}",
  "{s} online",
  "cheap {s}",
  "best {s}",
  "men's {s}",
  "women's {s}",
  "{s} sale",
  "designer {s}",
  "{s} shop",
];

const INFO_PATTERNS = [
  "how to choose {s}",
  "what is {s}",
  "best {s} guide",
  "are {s} worth it",
  "{s} vs alternatives",
];

function phraseAt(seed: string, index: number): string {
  const lower = seed.toLowerCase();
  const infoEvery = 7;
  if (index % infoEvery === 0) {
    const pattern = INFO_PATTERNS[index % INFO_PATTERNS.length];
    return pattern.replace("{s}", lower);
  }
  const pattern = CATEGORY_PATTERNS[index % CATEGORY_PATTERNS.length];
  const suffix = index >= CATEGORY_PATTERNS.length ? ` ${Math.floor(index / CATEGORY_PATTERNS.length)}` : "";
  return `${pattern.replace("{s}", lower)}${suffix}`.trim();
}

function relatedFor(seed: string): RelatedKeyword[] {
  const lower = seed.toLowerCase();
  return [
    { keyword: `best ${lower}`, volume: 1200, keywordDifficulty: 34 },
    { keyword: `${lower} online`, volume: 880, keywordDifficulty: 29 },
    { keyword: `buy ${lower}`, volume: 640, keywordDifficulty: 22 },
  ];
}

function questionsFor(seed: string): RelatedKeyword[] {
  const lower = seed.toLowerCase();
  return [
    { keyword: `what is ${lower}`, volume: 320, keywordDifficulty: 18 },
    { keyword: `how to choose ${lower}`, volume: 210, keywordDifficulty: 16 },
  ];
}

function metricsFor(seed: string, database: string): SeedMetrics {
  const ideas = rawFor(seed);
  const h = hash(seed);
  return {
    seed,
    database,
    volume: Math.max(40, Math.round((ideas * 2.4) / 10) * 10),
    cpcUsd: Math.round((0.4 + (h % 80) / 10) * 100) / 100,
    keywordDifficulty: 12 + (h % 60),
    competition: Math.round(((h % 90) / 100) * 100) / 100,
    intents: sheetForIntents(["commercial"]) === "category" ? ["commercial"] : ["informational"],
    trend12m: Array.from({ length: 12 }, (_, i) => 40 + ((h + i * 7) % 50)),
    keywordIdeasTotal: ideas,
    keywordIdeasTotalVolume: ideas * 18,
    relatedKeywords: relatedFor(seed),
    questions: questionsFor(seed),
  };
}

function rowAt(seed: string, database: string, index: number): KeywordRow {
  const phrase = phraseAt(seed, index);
  const h = hash(phrase);
  const intents = intentsFor(index, phrase);
  return {
    phrase,
    database,
    volume: 20 + (h % 9800),
    cpc: Math.round(((h % 400) / 100) * 100) / 100,
    competitionLevel: Math.round(((h % 90) / 100) * 100) / 100,
    difficulty: 8 + (h % 72),
    results: 1_000_000 + h * 100,
    intents,
    serpFeatures: index % 4 === 0 ? ["people_also_ask"] : [],
    trends: Array.from({ length: 12 }, (_, i) => 30 + ((h + i) % 60)),
    seed,
  };
}

export function createMockKeywordProvider(): KeywordDataProvider {
  return {
    async fetchSeedMetrics(seeds, database) {
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const raw of seeds) {
        const seed = normalizeSeedTerm(raw);
        if (!seed) continue;
        const key = seed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(seed);
      }
      return unique.map((seed) => metricsFor(seed, database));
    },

    async startKeywordIdeas(seed, database, filters) {
      const term = normalizeSeedTerm(seed);
      const safeLimit = Math.min(
        EXTRACT_CAP_PER_SEED,
        Math.max(1, Math.floor(filters.limitPerSeed) || 1)
      );
      return {
        runId: encodeHandle({
          seed: term,
          database,
          limitPerSeed: safeLimit,
          minVolume: filters.minVolume,
          maxDifficulty: filters.maxDifficulty,
          startedAt: Date.now(),
        }),
        seed: term,
        database,
        limitPerSeed: safeLimit,
      };
    },

    async pollKeywordIdeas(handle, cursor) {
      const payload = decodeHandle(handle.runId);
      if (!payload) {
        return { status: "failed", rows: [], error: "Unknown mock run" };
      }
      const rawTotal = rawFor(payload.seed);
      const elapsed = Date.now() - payload.startedAt;
      const arrivedRaw = Math.min(
        rawTotal,
        Math.max(0, Math.round((elapsed / MOCK_DURATION_MS) * rawTotal))
      );
      const filteredCap = Math.min(payload.limitPerSeed, EXTRACT_CAP_PER_SEED);
      // Server-side minVolume/maxDifficulty filters, applied the same way
      // amassuo/semrush-keyword-expander applies them before billing.
      const filtered: KeywordRow[] = [];
      for (let i = 0; i < arrivedRaw && filtered.length < filteredCap; i += 1) {
        const row = rowAt(payload.seed, payload.database, i);
        if (passesFilters(row, payload.minVolume, payload.maxDifficulty)) {
          filtered.push(row);
        }
      }
      const offset = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
      const end = Math.min(filtered.length, offset + CHUNK);
      const rows = filtered.slice(offset, end);
      const rawExhausted = arrivedRaw >= rawTotal;
      const capReached = filtered.length >= filteredCap;
      const done = rawExhausted || capReached;
      return {
        status: done && end >= filtered.length ? "succeeded" : "running",
        rows,
        nextCursor: end < filtered.length ? String(end) : undefined,
      };
    },

    async abortKeywordIdeas() {
      // Mock runs are computed from timestamps; nothing to cancel server-side.
    },
  };
}

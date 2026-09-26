import {
  imageFileKey,
  isOkPage,
  nearCodeKey,
  normalizeImageKey,
  pageShowsImage,
  pageSite,
  type EvidenceLedger,
  type PageEvidence,
} from "./evidence";
import {
  distinctiveWords,
  normalizeCode,
  normalizeMatchText,
  wordsPresentRatio,
  type RowIdentifier,
} from "./tools/identifiers";

export type MatchBasis = "identifier" | "near_identifier" | "model_variant" | "best_match";

export interface ImageFinderAnswer {
  status: string;
  verification?: { pageUrl?: string; identifierSeen?: string; brandSeen?: string; matchBasis?: string };
  images?: Array<{ url?: string; pageUrl?: string }>;
  notes?: string;
}

export interface GuardedResult {
  found: boolean;
  matchBasis: MatchBasis | null;
  /** Shown to the store owner for anything weaker than an exact code match. Empty for exact matches. */
  matchNote: string;
  verifiedPageUrl: string | null;
  images: Array<{ imageUrl: string; pageUrl: string }>;
  rejections: string[];
}

/** Share of the row's distinctive words a best-match page must show. */
export const BEST_MATCH_MIN_WORD_SHARE = 0.6;
export const BEST_MATCH_MIN_WORDS = 2;
/** Independent websites that must show the same near code. */
export const NEAR_CODE_MIN_SITES = 2;

const notFound = (rejections: string[]): GuardedResult => ({
  found: false,
  matchBasis: null,
  matchNote: "",
  verifiedPageUrl: null,
  images: [],
  rejections,
});

interface Tier {
  matchBasis: MatchBasis;
  matchNote: string;
  /** Test every image's source page must pass (the verified page passes by construction). */
  pagePasses: (evidence: PageEvidence) => boolean;
}

type TierResult = Tier | { rejection: string };

/** Letters plus at least three digits, five or more characters: a part number, not a family name. */
function isSpecificPartNumber(key: string): boolean {
  return key.length >= 5 && /[A-Z]/.test(key) && (key.match(/\d/g)?.length ?? 0) >= 3;
}

function bestMatchTier(
  answer: ImageFinderAnswer,
  verified: PageEvidence,
  pageUrl: string,
  rowData: Record<string, string>,
): TierResult {
  const brand = normalizeMatchText(String(answer.verification?.brandSeen ?? "")).trim();
  if (!brand) {
    return { rejection: "This row has no code, and no brand was confirmed on the page, so the item cannot be matched safely." };
  }
  const rowText = normalizeMatchText(Object.values(rowData).join(" "));
  if (!rowText.includes(` ${brand} `)) {
    return { rejection: `The brand "${answer.verification?.brandSeen}" is not in this row's data.` };
  }
  const brandWords = new Set(brand.split(" "));
  const words = distinctiveWords(rowData).filter((word) => !brandWords.has(word));
  if (words.length < BEST_MATCH_MIN_WORDS) {
    return { rejection: "This row has no code and too little description to match an item safely." };
  }
  const pagePasses = (evidence: PageEvidence) =>
    evidence.matchText.includes(` ${brand} `) &&
    wordsPresentRatio(words, evidence.matchText) >= BEST_MATCH_MIN_WORD_SHARE;
  if (!pagePasses(verified)) {
    return { rejection: `The page ${pageUrl} does not match this row's brand and description closely enough.` };
  }
  return {
    matchBasis: "best_match",
    matchNote: "Best match by title and brand (no code in the sheet).",
    pagePasses,
  };
}

function nearCodeTier(
  answer: ImageFinderAnswer,
  verified: PageEvidence,
  pageUrl: string,
  ledger: EvidenceLedger,
  rowIdentifiers: RowIdentifier[],
): TierResult {
  const strongKeys = rowIdentifiers.filter((id) => id.strong).map((id) => id.key);
  const okPages = ledger.all().filter(isOkPage);
  const exact = okPages.find((evidence) => strongKeys.some((key) => evidence.identifierKeys.has(key)));
  if (exact) {
    return { rejection: `The exact code appears on ${exact.finalUrl || exact.url}, so a near code cannot be used.` };
  }
  const claimed = normalizeCode(String(answer.verification?.identifierSeen ?? ""));
  const candidates = [...verified.nearCodes].sort(
    (a, b) => Number(b.endsWith(`>${claimed}`)) - Number(a.endsWith(`>${claimed}`)),
  );
  if (candidates.length === 0) {
    return { rejection: `No code one or two trailing letters away from this row's code appears on ${pageUrl}.` };
  }
  for (const candidate of candidates) {
    const sites = new Set(okPages.filter((evidence) => evidence.nearCodes.has(candidate)).map(pageSite));
    if (sites.size < NEAR_CODE_MIN_SITES) continue;
    const [rowKey, pageCode] = candidate.split(">") as [string, string];
    const rowValue = rowIdentifiers.find((id) => id.key === rowKey)?.value ?? rowKey;
    const shown = claimed === pageCode ? String(answer.verification?.identifierSeen).trim() : pageCode;
    return {
      matchBasis: "near_identifier",
      matchNote: `Near code: the page shows ${shown}, the sheet has ${rowValue}.`,
      pagePasses: (evidence) => evidence.nearCodes.has(nearCodeKey(rowKey, pageCode)),
    };
  }
  const pageCode = candidates[0]!.split(">")[1];
  return {
    rejection: `The near code ${pageCode} was confirmed on only one website; a second independent website is required.`,
  };
}

function codeTier(answer: ImageFinderAnswer, verified: PageEvidence, pageUrl: string, rowIdentifiers: RowIdentifier[]): TierResult {
  const strongKeys = rowIdentifiers.filter((id) => id.strong).map((id) => id.key);
  const claimed = normalizeCode(String(answer.verification?.identifierSeen ?? ""));
  const strongSeen = strongKeys.filter((key) => verified.identifierKeys.has(key));
  if (strongSeen.length > 0) {
    const required = strongSeen.includes(claimed) ? claimed : strongSeen[0]!;
    return {
      matchBasis: "identifier",
      matchNote: "",
      pagePasses: (evidence) => evidence.identifierKeys.has(required),
    };
  }
  const anySeen = rowIdentifiers.map((id) => id.key).filter((key) => verified.identifierKeys.has(key));
  if (anySeen.length === 0) {
    return { rejection: `None of this row's identifiers appear on ${pageUrl}.` };
  }
  // A short part number (AN241, BC547) is still the row's exact code when the
  // row has nothing more specific; family names (ESP32) stay model matches.
  const exactPartNumber =
    strongKeys.length === 0 ? anySeen.find((key) => isSpecificPartNumber(key)) : undefined;
  if (exactPartNumber) {
    return {
      matchBasis: "identifier",
      matchNote: "",
      pagePasses: (evidence) => evidence.identifierKeys.has(exactPartNumber),
    };
  }
  return {
    matchBasis: "model_variant",
    matchNote: "Matched by model and variant (no store code on the page).",
    pagePasses: (evidence) => anySeen.every((key) => evidence.identifierKeys.has(key)),
  };
}

/**
 * Accepts the model's answer only where our own tools' record backs it up.
 * The verified page must have been opened successfully, then one tier applies:
 * - identifier: a strong row code (SKU/barcode/model code) is on the page;
 * - model_variant: only weaker row codes (model and variant tokens) are on it;
 * - near_identifier (claimed by the model): the exact code is on no opened
 *   page, and the same trailing-letter variant is on at least two websites;
 * - best_match: only for rows with no code at all — the brand is in the row
 *   and on the page, and most of the row's distinctive words are on the page.
 * Every image must appear on an opened page that passes the same tier's test;
 * repeated copies of one image are removed.
 */
export function guardImageFinderAnswer(input: {
  answer: ImageFinderAnswer;
  ledger: EvidenceLedger;
  rowIdentifiers: RowIdentifier[];
  rowData?: Record<string, string>;
}): GuardedResult {
  const { answer, ledger, rowIdentifiers } = input;
  const pageUrl = String(answer.verification?.pageUrl ?? "").trim();
  if (answer.status !== "found" || !pageUrl) return notFound([]);

  const verified = ledger.find(pageUrl);
  if (!isOkPage(verified)) {
    return notFound([`The verified page ${pageUrl} was not opened successfully during research.`]);
  }

  const strongOnPage = rowIdentifiers.some((id) => id.strong && verified.identifierKeys.has(id.key));
  const tier: TierResult =
    rowIdentifiers.length === 0
      ? bestMatchTier(answer, verified, pageUrl, input.rowData ?? {})
      : answer.verification?.matchBasis === "near_identifier" && !strongOnPage
        ? nearCodeTier(answer, verified, pageUrl, ledger, rowIdentifiers)
        : codeTier(answer, verified, pageUrl, rowIdentifiers);
  if ("rejection" in tier) return notFound([tier.rejection]);

  const rejections: string[] = [];
  const images: GuardedResult["images"] = [];
  const seenKeys = new Set<string>();
  for (const item of answer.images ?? []) {
    const imageUrl = String(item?.url ?? "").trim();
    if (!/^https?:\/\//i.test(imageUrl)) continue;
    const sourceUrl = String(item?.pageUrl ?? "").trim() || pageUrl;
    const source = ledger.find(sourceUrl);
    if (!isOkPage(source)) {
      rejections.push(`${imageUrl}: its page ${sourceUrl} was not opened.`);
      continue;
    }
    if (!tier.pagePasses(source)) {
      rejections.push(`${imageUrl}: its page ${sourceUrl} does not show the same item.`);
      continue;
    }
    if (!pageShowsImage(source, imageUrl)) {
      rejections.push(`${imageUrl}: this link does not appear on ${sourceUrl}.`);
      continue;
    }
    const key = normalizeImageKey(imageUrl);
    const file = imageFileKey(imageUrl);
    if (seenKeys.has(key) || (file && seenKeys.has(file))) continue;
    seenKeys.add(key);
    if (file) seenKeys.add(file);
    images.push({ imageUrl, pageUrl: source === verified ? pageUrl : sourceUrl });
  }

  return {
    found: true,
    matchBasis: tier.matchBasis,
    matchNote: tier.matchNote,
    verifiedPageUrl: pageUrl,
    images,
    rejections,
  };
}

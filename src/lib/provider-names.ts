/**
 * Customers never see which AI or search providers do the work. New text is
 * written without them; this also cleans text that was saved on rows before
 * that rule (match notes, "Not found" reasons, row errors) when it is shown.
 * Client-safe and pure.
 */

// This file ships to the browser, so the names are stored encoded: a plain
// literal here would itself reveal them in the page's JavaScript.
const decode = (b64: string) => atob(b64);
const AI_MODE = decode("R29vZ2xlIEFJIE1vZGU=");
const SEARCH_API = decode("U2VhcmNoQXBp");
const GPT = decode("R1BU");
const SOL = decode("U29s");
const TERRA = decode("dGVycmE=");
const OPEN_AI = decode("T3BlbkFJ");
const GEMINI = decode("R2VtaW5p");
const FLASH = decode("Rmxhc2g=");
const SERPER = decode("U2VycGVy");
const GOOGLE_SDK = decode("R29vZ2xlR2VuZXJhdGl2ZUFJ");
const GOOGLE_API_HOST = decode("Z2VuZXJhdGl2ZWxhbmd1YWdl");
const GOOGLE_APIS = decode("Z29vZ2xlYXBpcw==");

const OLD_EXACT_MATCH_NOTE = new RegExp(
  `Exact match\\s*[^\\sA-Za-z]{0,6}\\s*${AI_MODE} found the product link; ${GPT}-[\\d.]+ ${SOL} confirmed it and pulled the images\\.`,
  "g"
);
const EXACT_MATCH_NOTE_TEXT = "Exact match: the product page was confirmed and its images were taken from it.";

/** Replaces each match with "the web search", capitalised when it opens a sentence. */
function replaceWithWebSearch(text: string, pattern: RegExp): string {
  return text.replace(pattern, (...args) => {
    const offset = args[args.length - 2] as number;
    const before = text.slice(0, offset).trimEnd();
    return before === "" || /[.!?]$/.test(before) ? "The web search" : "the web search";
  });
}

export function hideProviderNames(text: string): string;
export function hideProviderNames(text: string | undefined): string | undefined;
export function hideProviderNames(text: string | undefined): string | undefined {
  if (!text) return text;
  const cleaned = text
    .replace(
      new RegExp(`\\s*(?:at\\s+)?https?://\\S*(?:${OPEN_AI}|${GOOGLE_APIS})\\S*?(?=[.,;)"]?(?:\\s|$))`, "gi"),
      ""
    )
    .replace(new RegExp(`\\S*${GOOGLE_API_HOST}\\S*`, "gi"), "AI service")
    .replace(new RegExp(`\\[?${GOOGLE_SDK}(?:\\s+Error)?\\]?:?\\s*`, "gi"), "")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "[key]")
    .replace(OLD_EXACT_MATCH_NOTE, EXACT_MATCH_NOTE_TEXT)
    .replace(new RegExp(`${SEARCH_API}(?:\\.io)?\\s+(?=${AI_MODE})`, "gi"), "");
  return replaceWithWebSearch(cleaned, new RegExp(AI_MODE, "gi"))
    .replace(new RegExp(`${SEARCH_API}(?:\\.io)?`, "gi"), "web search")
    .replace(new RegExp(`\\b${GPT}-[\\d.]+(?:[-\\s](?:${SOL}|${TERRA})\\b)?`, "gi"), "the AI agent")
    .replace(new RegExp(`\\b${OPEN_AI}\\b`, "gi"), "AI")
    .replace(
      new RegExp(`\\b${GEMINI}(?:-[\\w.-]+|\\s+[\\d.]+(?:\\s+(?:${FLASH}|Pro))?)?`, "gi"),
      "AI"
    )
    .replace(new RegExp(`\\b${SERPER}\\b`, "gi"), "image search");
}

/** A row as it is shown: error text saved by an older run may still name a provider. */
export function withDisplayError<T extends { errorMessage?: string }>(row: T): T {
  if (!row.errorMessage) return row;
  const shown = hideProviderNames(row.errorMessage);
  return shown === row.errorMessage ? row : { ...row, errorMessage: shown };
}

/**
 * Customers never see which AI or search providers do the work. New text is
 * written without them; this also cleans text that was saved on rows before
 * that rule (match notes, "Not found" reasons, row errors) when it is shown.
 * Client-safe and pure.
 */

const OLD_EXACT_MATCH_NOTE =
  /Exact match\s*[^\sA-Za-z]{0,6}\s*Google AI Mode found the product link; GPT-[\d.]+ Sol confirmed it and pulled the images\./g;
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
    .replace(OLD_EXACT_MATCH_NOTE, EXACT_MATCH_NOTE_TEXT)
    .replace(/SearchApi(?:\.io)?\s+(?=Google AI Mode)/gi, "");
  return replaceWithWebSearch(cleaned, /Google AI Mode/gi)
    .replace(/SearchApi(?:\.io)?/gi, "web search")
    .replace(/\bgpt-[\d.]+(?:[-\s](?:sol|terra)\b)?/gi, "the AI agent")
    .replace(/\bOpenAI\b/g, "AI")
    .replace(/\bGemini(?:\s+[\d.]+(?:\s+(?:Flash|Pro))?)?/g, "AI")
    .replace(/\bSerper\b/g, "image search");
}

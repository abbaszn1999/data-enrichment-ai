/**
 * JSON extraction from Google AI Mode answers. The answer is free text even
 * when JSON is asked for: commentary before or after it, several code
 * fences, smart quotes, trailing commas and comments have all been seen. A
 * weak extractor here turns a real answer into a false "Not found", so this
 * scans the whole text for EVERY JSON value (objects and arrays), repairs the
 * common damage, and lets the caller pick the one that has the expected
 * shape. Pure and dependency-free so it can be tested on captured answers.
 */

/** Guards against pathological input; real answers are a few KB. */
const MAX_TEXT_CHARS = 200_000;
const MAX_CANDIDATES = 60;

const SMART_DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033]/g;

/** End index (inclusive) of the balanced `{}`/`[]` segment starting at `start`, or -1. */
function matchBalanced(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/**
 * Fixes the damage seen in model-written JSON without touching string
 * contents: comments and trailing commas outside strings are dropped, and raw
 * line breaks or tabs inside strings are escaped.
 */
export function repairJson(segment: string): string {
  const out: string[] = [];
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (inString) {
      if (escapeNext) {
        out.push(ch);
        escapeNext = false;
      } else if (ch === "\\") {
        out.push(ch);
        escapeNext = true;
      } else if (ch === '"') {
        out.push(ch);
        inString = false;
      } else if (ch === "\n") {
        out.push("\\n");
      } else if (ch === "\r") {
        // dropped: the \n that follows (if any) carries the break
      } else if (ch === "\t") {
        out.push("\\t");
      } else {
        out.push(ch);
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out.push(ch);
      continue;
    }
    if (ch === "/" && segment[i + 1] === "/") {
      while (i < segment.length && segment[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && segment[i + 1] === "*") {
      const end = segment.indexOf("*/", i + 2);
      i = end === -1 ? segment.length : end + 1;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < segment.length && /\s/.test(segment[j]!)) j += 1;
      if (segment[j] === "}" || segment[j] === "]") continue;
    }
    out.push(ch);
  }
  return out.join("");
}

function tryParse(segment: string): unknown | undefined {
  try {
    return JSON.parse(segment);
  } catch {
    // fall through to the repaired form
  }
  try {
    return JSON.parse(repairJson(segment));
  } catch {
    return undefined;
  }
}

function collect(text: string): unknown[] {
  const found: unknown[] = [];
  let i = 0;
  while (i < text.length && found.length < MAX_CANDIDATES) {
    const next = text.slice(i).search(/[{[]/);
    if (next === -1) break;
    const start = i + next;
    const end = matchBalanced(text, start);
    if (end === -1) {
      i = start + 1;
      continue;
    }
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed !== undefined && parsed !== null && typeof parsed === "object") {
      found.push(parsed);
      i = end + 1;
    } else {
      // Not valid even after repair: look inside it for smaller valid values.
      i = start + 1;
    }
  }
  return found;
}

/**
 * Every JSON object or array found in the text, in order (top-level values
 * only: a value inside an already-parsed one is not repeated). Code fences
 * and surrounding prose are simply skipped over. When `accept` is given and
 * no value passes it, the text is scanned once more with curly quotes turned
 * into straight ones, which rescues answers whose JSON was typeset.
 */
export function extractJsonValues(text: string, accept?: (value: unknown) => boolean): unknown[] {
  if (!text) return [];
  const source = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const first = collect(source);
  if (!accept || first.some(accept)) return first;
  const normalized = source.replace(SMART_DOUBLE_QUOTES, '"');
  if (normalized === source) return first;
  const second = collect(normalized);
  return second.some(accept) ? second : first;
}

/**
 * The first JSON object in the text (arrays are not objects and are skipped).
 * Kept for callers that want any object; answer parsing that needs a
 * particular shape uses extractJsonValues.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const value = extractJsonValues(text).find((v) => v && typeof v === "object" && !Array.isArray(v));
  return (value as Record<string, unknown> | undefined) ?? null;
}

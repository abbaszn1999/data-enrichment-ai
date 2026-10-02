/**
 * SearchApi.io client for Google AI Mode (finds product-page links for the
 * Source URLs column; see ../../source-urls/search.ts). This needs a
 * REST API key from the SearchApi dashboard (SEARCHAPI_API_KEY); the MCP
 * token used inside Cursor only authenticates the editor's MCP connection
 * and does not work for server-side calls like this one.
 */

export const SEARCHAPI_BASE = "https://www.searchapi.io/api/v1/search";
/**
 * Live calls answer in ~7-17s. A slow call is worth waiting for (SearchApi
 * bills any 200 even if we already hung up), but the row still has to fit the
 * row timeout (jobs/config.ts): Source URLs runs up to 2 searches of this
 * length. Do not raise this past ~150s.
 */
const REQUEST_TIMEOUT_MS = 120_000;

export function requireSearchApiKey(): string {
  const apiKey = process.env.SEARCHAPI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "SEARCHAPI_API_KEY is not configured (required for Source URLs)"
    );
  }
  return apiKey;
}

/**
 * A failed Google AI Mode call. `billed` says whether SearchApi charged for
 * it: it bills a request that returned HTTP 200 with a Success status, and
 * does not bill errors, timeouts we never got an answer to, or non-200s.
 */
export class SearchApiCallError extends Error {
  readonly billed: boolean;
  /** HTTP status of a non-200 answer; undefined for network errors, timeouts and error bodies. */
  readonly status?: number;

  constructor(message: string, billed: boolean, status?: number) {
    super(message);
    this.name = "SearchApiCallError";
    this.billed = billed;
    this.status = status;
  }
}

/** A busy or briefly failing SearchApi (rate limit, 5xx): worth one more try. Never billed. */
export function isTransientSearchApiError(error: unknown): boolean {
  return (
    error instanceof SearchApiCallError &&
    !error.billed &&
    typeof error.status === "number" &&
    (error.status === 429 || error.status >= 500)
  );
}

export interface GoogleAiModeReferenceLink {
  link: string;
  title?: string;
  snippet?: string;
  source?: string;
}

export interface GoogleAiModeResult {
  /** The answer text to read first (text_blocks joined, else markdown). Empty when the call returned no text. */
  text: string;
  /**
   * Every distinct rendering of the answer, best first: the joined
   * text_blocks (list and table items included) and the markdown. A parser
   * tries each, because the JSON we asked for can sit in either.
   */
  texts: string[];
  referenceLinks: GoogleAiModeReferenceLink[];
  httpStatus: number;
  elapsedMs: number;
}

interface GoogleAiModeApiResponse {
  search_metadata?: { status?: string };
  text_blocks?: unknown[];
  markdown?: unknown;
  reference_links?: Array<{ link?: unknown; title?: unknown; snippet?: unknown; source?: unknown }>;
  error?: unknown;
}

/** Keys of a text block that carry readable text. */
const TEXT_KEYS = new Set(["answer", "code", "text", "content", "value", "snippet"]);

/**
 * Text of one text_blocks entry, including list items and table cells, which
 * nest their text under other keys than a plain paragraph's `answer`.
 */
function blockText(block: unknown, depth = 0): string[] {
  if (depth > 6 || block === null || block === undefined) return [];
  if (typeof block === "string") return [block];
  if (Array.isArray(block)) return block.flatMap((item) => blockText(item, depth + 1));
  if (typeof block !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
    if (TEXT_KEYS.has(key) && typeof value === "string") out.push(value);
    else if (value && typeof value === "object") out.push(...blockText(value, depth + 1));
  }
  return out;
}

/** The distinct renderings of an answer, in the order a parser should try them. */
export function answerTexts(data: Pick<GoogleAiModeApiResponse, "text_blocks" | "markdown">): string[] {
  const fromBlocks = (Array.isArray(data.text_blocks) ? data.text_blocks : [])
    .flatMap((block) => blockText(block))
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
  const markdown = typeof data.markdown === "string" ? data.markdown.trim() : "";
  const texts: string[] = [];
  if (fromBlocks) texts.push(fromBlocks);
  if (markdown && markdown !== fromBlocks) texts.push(markdown);
  return texts;
}

/**
 * Calls SearchApi's Google AI Mode engine with one query. Returns only for a
 * billed call (HTTP 200, Success): the caller records that cost immediately,
 * even when the answer then turns out unusable. A call that throws was not
 * billed unless the error says so (SearchApiCallError.billed).
 */
export async function callGoogleAiMode(
  query: string,
  options: {
    /**
     * One public image URL for Google to look at alongside the query (SearchApi's
     * `url` parameter). It takes a single image: a second `url` replaces the first.
     */
    imageUrl?: string;
  } = {}
): Promise<GoogleAiModeResult> {
  const apiKey = requireSearchApiKey();
  const params = new URLSearchParams({
    engine: "google_ai_mode",
    q: query,
    api_key: apiKey,
  });
  if (options.imageUrl) params.set("url", options.imageUrl);

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${SEARCHAPI_BASE}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new SearchApiCallError(
      `Web search request failed: ${error instanceof Error ? error.message : String(error)}`,
      false
    );
  } finally {
    clearTimeout(timer);
  }

  let rawText: string;
  try {
    rawText = await response.text();
  } catch (error) {
    throw new SearchApiCallError(
      `Web search response could not be read: ${error instanceof Error ? error.message : String(error)}`,
      false
    );
  }
  if (!response.ok) {
    throw new SearchApiCallError(
      `Web search failed (${response.status}): ${rawText.slice(0, 300)}`,
      false,
      response.status
    );
  }

  let data: GoogleAiModeApiResponse;
  try {
    data = JSON.parse(rawText) as GoogleAiModeApiResponse;
  } catch {
    throw new SearchApiCallError("Web search returned a non-JSON body", false);
  }
  const status = data.search_metadata?.status;
  if (data.error || (typeof status === "string" && status !== "Success")) {
    // SearchApi charges Success responses only; an error body is not one.
    console.warn("[Google AI Mode] Google AI Mode returned an error body with HTTP 200", {
      status,
      error: String(data.error ?? "").slice(0, 200),
    });
    throw new SearchApiCallError(String(data.error ?? `Web search status ${status}`), false);
  }

  const texts = answerTexts(data);
  const referenceLinks: GoogleAiModeReferenceLink[] = (data.reference_links ?? [])
    .map((ref) => ({
      link: String(ref?.link ?? "").trim(),
      title: typeof ref?.title === "string" ? ref.title : undefined,
      snippet: typeof ref?.snippet === "string" ? ref.snippet : undefined,
      source: typeof ref?.source === "string" ? ref.source : undefined,
    }))
    .filter((ref) => /^https?:\/\//i.test(ref.link));

  return {
    text: texts[0] ?? "",
    texts,
    referenceLinks,
    httpStatus: response.status,
    elapsedMs: Date.now() - startedAt,
  };
}

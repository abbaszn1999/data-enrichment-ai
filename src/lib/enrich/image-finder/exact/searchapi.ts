/**
 * SearchApi.io client for Google AI Mode — Image Finder "Exact Match" Agent 1
 * (finds exact-match product-page links; see exact/agent.ts). This needs a
 * REST API key from the SearchApi dashboard (SEARCHAPI_API_KEY); the MCP
 * token used inside Cursor only authenticates the editor's MCP connection
 * and does not work for server-side calls like this one.
 */

export const SEARCHAPI_BASE = "https://www.searchapi.io/api/v1/search";
const REQUEST_TIMEOUT_MS = 45_000;

export function requireSearchApiKey(): string {
  const apiKey = process.env.SEARCHAPI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "SEARCHAPI_API_KEY is not configured (required for Image Finder Exact Match)"
    );
  }
  return apiKey;
}

export interface GoogleAiModeReferenceLink {
  link: string;
  title?: string;
  snippet?: string;
  source?: string;
}

export interface GoogleAiModeResult {
  /** The model's raw answer text (text_blocks joined, falling back to markdown). */
  text: string;
  referenceLinks: GoogleAiModeReferenceLink[];
}

interface GoogleAiModeApiResponse {
  search_metadata?: { status?: string };
  text_blocks?: Array<{ answer?: unknown }>;
  markdown?: string;
  reference_links?: Array<{ link?: unknown; title?: unknown; snippet?: unknown; source?: unknown }>;
  error?: unknown;
}

/**
 * Calls SearchApi's Google AI Mode engine with one query. Billed on success
 * (HTTP 200) only — see SEARCHAPI_COST_PER_SEARCH in lib/ai-pricing.ts. The
 * caller is responsible for recording that cost even when the answer ends up
 * unusable (the request still happened and SearchApi still billed it).
 */
export async function callGoogleAiMode(query: string): Promise<GoogleAiModeResult> {
  const apiKey = requireSearchApiKey();
  const params = new URLSearchParams({
    engine: "google_ai_mode",
    q: query,
    api_key: apiKey,
  });

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
    throw new Error(
      `SearchApi Google AI Mode request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`SearchApi Google AI Mode failed (${response.status}): ${rawText.slice(0, 300)}`);
  }

  let data: GoogleAiModeApiResponse;
  try {
    data = JSON.parse(rawText) as GoogleAiModeApiResponse;
  } catch {
    throw new Error("SearchApi Google AI Mode returned non-JSON body");
  }
  if (data.error) {
    throw new Error(String(data.error));
  }

  const fromBlocks = (data.text_blocks ?? [])
    .map((block) => (typeof block?.answer === "string" ? block.answer : ""))
    .filter(Boolean)
    .join("\n");
  const text = fromBlocks || (typeof data.markdown === "string" ? data.markdown : "");

  const referenceLinks: GoogleAiModeReferenceLink[] = (data.reference_links ?? [])
    .map((ref) => ({
      link: String(ref?.link ?? "").trim(),
      title: typeof ref?.title === "string" ? ref.title : undefined,
      snippet: typeof ref?.snippet === "string" ? ref.snippet : undefined,
      source: typeof ref?.source === "string" ? ref.source : undefined,
    }))
    .filter((ref) => /^https?:\/\//i.test(ref.link));

  return { text, referenceLinks };
}

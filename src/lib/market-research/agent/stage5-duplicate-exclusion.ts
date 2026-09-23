import { runGeminiMarketResearch } from "./gemini-runner";
import {
  parseDuplicateExclusionResponse,
  type DuplicateExclusionResult,
} from "./duplicate-matches";

/** Minimal shape needed to judge a proposed new collection's shopper intent. */
export interface NewCollectionForDuplicateCheck {
  id: string;
  name: string;
  description?: string;
}

/** Minimal shape needed to represent one of the merchant's existing PLPs. */
export interface ExistingCollectionForDuplicateCheck {
  id: string;
  name: string;
  description?: string;
}

export type { DuplicateExclusionResult, DuplicateMatch } from "./duplicate-matches";

const DUPLICATE_CHECK_ATTEMPTS = 3;
/** The check runs inside the collections job, so one call may take longer than a web request. */
const DUPLICATE_CHECK_TIMEOUT_MS = 300_000;

interface GeminiDuplicateExclusionResponse {
  duplicates: Array<{
    id: string;
    status: "duplicate";
    existingId?: string;
    existingName?: string;
    matches?: Array<{ id: string; name: string }>;
  }>;
}

const DUPLICATE_EXCLUSION_SYSTEM_INSTRUCTION = `Apply the single duplicate test from your instructions to every entry in newCollections against the full existingCollections list. Output strictly valid JSON matching this schema, listing ONLY the ids that are duplicates — omit every non-duplicate entirely:
{
  "duplicates": [
    {
      "id": "string (matching a newCollections id)",
      "status": "duplicate",
      "existingId": "string (matching an existingCollections id, when you can name the live PLP)",
      "existingName": "string (that live PLP's name)",
      "matches": [{ "id": "string", "name": "string" }]
    }
  ]
}
existingId, existingName, and matches are optional. If you cannot name the matching live PLP, still flag the duplicate with only id and status.`;

/**
 * Stage 5 Phase 3 — one single Gemini 3.7 Flash call (no batching) that
 * compares the final `newCollections` list Stage 5 just produced against the
 * merchant's `existingCollections` (live store PLPs for Growth Engine, the
 * uploaded sheet for Free Assessment) and flags semantic shopper-intent
 * duplicates. Output is the flagged ids plus any named live PLPs the model
 * attached — every id absent from the response implicitly stays "new".
 */
export async function runDuplicateCollectionExclusion(
  newCollections: NewCollectionForDuplicateCheck[],
  existingCollections: ExistingCollectionForDuplicateCheck[]
): Promise<DuplicateExclusionResult> {
  // Nothing to check is a known state, not a failure — only the try/catch
  // below (an actual Gemini failure) may report checked: false.
  const empty: DuplicateExclusionResult = {
    duplicateIds: new Set(),
    matchesById: new Map(),
    checked: true,
  };
  if (newCollections.length === 0 || existingCollections.length === 0) {
    return empty;
  }

  // Names only: the skill judges intent from the name, and live PLP
  // descriptions (often long HTML) would multiply the prompt on big stores.
  const userPrompt = `Compare every new collection against the existing collections and flag duplicates by shopper-intent coverage. When you flag a duplicate, include the matching existing collection id and name if you can:
${JSON.stringify({
  newCollections: newCollections.map((c) => ({ id: c.id, name: c.name })),
  existingCollections: existingCollections.map((c) => ({ id: c.id, name: c.name })),
})}`;

  const newIds = new Set(newCollections.map((c) => c.id));
  const existingById = new Map(
    existingCollections.map((c) => [c.id, c.name] as const)
  );
  let lastError: unknown;
  for (let attempt = 1; attempt <= DUPLICATE_CHECK_ATTEMPTS; attempt += 1) {
    try {
      const geminiRes = await runGeminiMarketResearch<GeminiDuplicateExclusionResponse>({
        stage: 8,
        systemInstruction: DUPLICATE_EXCLUSION_SYSTEM_INSTRUCTION,
        userPrompt,
        timeoutMs: DUPLICATE_CHECK_TIMEOUT_MS,
      });
      return parseDuplicateExclusionResponse(geminiRes.data, newIds, existingById);
    } catch (error) {
      lastError = error;
      console.warn(
        `[Stage 5 Phase 3] Duplicate check failed (attempt ${attempt}/${DUPLICATE_CHECK_ATTEMPTS}):`,
        error
      );
      if (attempt < DUPLICATE_CHECK_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  console.warn(
    "[Stage 5 Phase 3] Duplicate check failed after retries; duplicate status is unknown, not \"new\":",
    lastError
  );
  return { duplicateIds: new Set(), matchesById: new Map(), checked: false };
}

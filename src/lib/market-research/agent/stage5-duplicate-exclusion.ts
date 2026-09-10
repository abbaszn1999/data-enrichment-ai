import { runGeminiMarketResearch } from "./gemini-runner";

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

interface GeminiDuplicateExclusionResponse {
  duplicates: Array<{ id: string; status: "duplicate" }>;
}

const DUPLICATE_EXCLUSION_SYSTEM_INSTRUCTION = `Apply the single duplicate test from your instructions to every entry in newCollections against the full existingCollections list. Output strictly valid JSON matching this schema, listing ONLY the ids that are duplicates — omit every non-duplicate entirely:
{
  "duplicates": [
    { "id": "string (matching a newCollections id)", "status": "duplicate" }
  ]
}`;

/**
 * Stage 5 Phase 3 — one single Gemini 3.7 Flash call (no batching) that
 * compares the final `newCollections` list Stage 5 just produced against the
 * merchant's `existingCollections` (live store PLPs for Growth Engine, the
 * uploaded sheet for Free Assessment) and flags semantic shopper-intent
 * duplicates. Output is deliberately minimized to only the flagged ids —
 * every id absent from the response implicitly stays "new".
 */
export async function runDuplicateCollectionExclusion(
  newCollections: NewCollectionForDuplicateCheck[],
  existingCollections: ExistingCollectionForDuplicateCheck[]
): Promise<Set<string>> {
  if (newCollections.length === 0 || existingCollections.length === 0) {
    return new Set();
  }

  const userPrompt = `Compare every new collection against the existing collections and flag duplicates by shopper-intent coverage:
${JSON.stringify(
  {
    newCollections: newCollections.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || undefined,
    })),
    existingCollections: existingCollections.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || undefined,
    })),
  },
  null,
  2
)}`;

  try {
    const geminiRes = await runGeminiMarketResearch<GeminiDuplicateExclusionResponse>({
      stage: 8,
      systemInstruction: DUPLICATE_EXCLUSION_SYSTEM_INSTRUCTION,
      userPrompt,
    });

    const duplicateIds = new Set<string>();
    const newIds = new Set(newCollections.map((c) => c.id));
    if (geminiRes.data && Array.isArray(geminiRes.data.duplicates)) {
      for (const item of geminiRes.data.duplicates) {
        if (item?.id && newIds.has(item.id)) {
          duplicateIds.add(item.id);
        }
      }
    }
    return duplicateIds;
  } catch (error) {
    console.warn(
      "[Stage 5 Phase 3] Duplicate-collection exclusion call failed; keeping every collection as \"new\":",
      error
    );
    return new Set();
  }
}

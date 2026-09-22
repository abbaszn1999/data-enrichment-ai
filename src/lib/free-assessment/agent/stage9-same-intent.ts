import { runGeminiMarketResearch } from "./gemini-runner";
import type { IntentTerm } from "./same-intent";

const SAME_INTENT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    groups: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["ids"],
      },
    },
  },
  required: ["groups"],
};

type SameIntentResponse = {
  groups?: Array<{ ids?: string[] }>;
};

const MAX_ATTEMPTS = 3;

/**
 * Ask Gemini which ids are the exact same search. Returns null when every
 * attempt fails so the caller keeps the whole batch.
 */
export async function judgeSameIntentTerms(
  terms: IntentTerm[]
): Promise<string[][] | null> {
  if (terms.length === 0) return [];

  const userPrompt = JSON.stringify({
    terms: terms.map((term) => ({
      id: term.id,
      keyword: term.keyword,
      volume: term.volume,
    })),
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await runGeminiMarketResearch<SameIntentResponse>({
        stage: 9,
        userPrompt,
        responseSchema: SAME_INTENT_RESPONSE_SCHEMA,
      });
      const groups = Array.isArray(response.data?.groups) ? response.data.groups : [];
      return groups
        .map((group) => (Array.isArray(group.ids) ? group.ids.filter((id) => typeof id === "string") : []))
        .filter((ids) => ids.length >= 2);
    } catch (err) {
      lastError = err;
      console.error(
        `[judgeSameIntentTerms] Batch failed (attempt ${attempt}/${MAX_ATTEMPTS}):`,
        err
      );
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
      }
    }
  }

  console.error("[judgeSameIntentTerms] Keeping batch after retries:", lastError);
  return null;
}

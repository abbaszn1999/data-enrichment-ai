import { calculateCallCost, costToCredits, type AiCallCost } from "@/lib/ai-pricing";
import { loadSkill, type MrThinkingLevel, type MarketResearchSkill } from "./skill-loader";
import { aiJsonParse } from "ai-json-safe-parse";

export const MR_DEFAULT_MODEL = "gemini-3.8-flash";

/** Gemini 3.8 Flash's published output ceiling — the largest budget any
 *  caller can request. Stage 1 taxonomy discovery runs at this ceiling by
 *  default since it can face thousands of PLPs in one batch. */
export const MR_MAX_OUTPUT_TOKENS = 65536;

/** Shared HTTP timeout for a single generateContent call. Large-catalog
 *  Stage 1 calls at high thinking + near-max output can exceed this —
 *  pass `timeoutMs` to override per call rather than raising the shared
 *  default for every stage. */
const DEFAULT_TIMEOUT_MS = 180000;

export interface GeminiRunOptions {
  stage: number;
  systemInstruction?: string;
  userPrompt: string;
  model?: string;
  overrideThinking?: MrThinkingLevel;
  /**
   * Optional JSON Schema constraining the shape Gemini is allowed to emit
   * (constrained decoding), on top of the looser `responseMimeType: "json"`
   * that only guarantees syntactically valid JSON. This catches malformed
   * shapes/fields but can't guarantee coverage of every requested id —
   * callers still need to check for missing items themselves.
   */
  responseSchema?: object;
  /** Overrides the shared 65,536-token ceiling for this call only. */
  maxOutputTokens?: number;
  /** Overrides the shared 180s HTTP timeout (ms) for this call only. */
  timeoutMs?: number;
}

export interface GeminiRunResult<T = unknown> {
  data: T;
  rawText: string;
  cost: AiCallCost;
  credits: number;
  model: string;
  thinkingLevel: MrThinkingLevel;
}

/** Finish reasons that mean the response is incomplete/unusable, not a
 *  smaller valid result. `aiJsonParse` can recover a syntactically-valid
 *  partial object from truncated JSON — without this check, a response cut
 *  off by the token ceiling used to come back as silent "success" with
 *  PLPs/items missing from the tail. Callers should retry with a smaller
 *  batch or a higher `maxOutputTokens`, not persist a partial result. */
const INCOMPLETE_FINISH_REASONS = new Set([
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "OTHER",
]);

export async function runGeminiMarketResearch<T = unknown>(
  opts: GeminiRunOptions
): Promise<GeminiRunResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = opts.model || process.env.MR_AGENT_MODEL || MR_DEFAULT_MODEL;

  const skill: MarketResearchSkill = await loadSkill(opts.stage);
  const thinkingLevel: MrThinkingLevel = opts.overrideThinking || skill.frontmatter.thinking;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured");
  }

  const { GoogleGenAI, ThinkingLevel } = await import("@google/genai");
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
  });

  const levelMap: Record<MrThinkingLevel, unknown> = {
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  };

  const finalSystemInstruction = [
    skill.instructions,
    opts.systemInstruction,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await ai.models.generateContent({
    model: modelName,
    contents: [
      {
        role: "user",
        parts: [{ text: opts.userPrompt }],
      },
    ],
    config: {
      systemInstruction: finalSystemInstruction,
      responseMimeType: "application/json",
      maxOutputTokens: opts.maxOutputTokens ?? MR_MAX_OUTPUT_TOKENS,
      ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
      thinkingConfig: {
        thinkingLevel: levelMap[thinkingLevel] as any,
      },
    },
  });

  const finishReason = response.candidates?.[0]?.finishReason as string | undefined;
  if (finishReason && INCOMPLETE_FINISH_REASONS.has(finishReason)) {
    throw new Error(
      `Gemini ${modelName} returned an incomplete response (finishReason: ${finishReason}) instead of finishing normally. ` +
        `This usually means the output was cut off before the JSON closed — retry with a smaller batch or a higher maxOutputTokens rather than trusting a partial result.`
    );
  }

  const rawText = response.text || "";
  let parsed: T;

  try {
    parsed = JSON.parse(rawText) as T;
  } catch {
    // Attempt robust recovery via aiJsonParse — safe now that a truncated
    // (MAX_TOKENS) response already threw above instead of reaching here.
    const recovered = aiJsonParse<T>(rawText);
    if (!recovered.success) {
      throw new Error(
        `Failed to parse structured JSON from ${modelName} output: ${rawText.slice(0, 300)}`
      );
    }
    parsed = recovered.data;
  }

  const usageMetadata = response.usageMetadata;
  const cost = calculateCallCost(modelName, usageMetadata);
  const credits = costToCredits(cost.totalCost);

  return {
    data: parsed,
    rawText,
    cost,
    credits,
    model: modelName,
    thinkingLevel,
  };
}

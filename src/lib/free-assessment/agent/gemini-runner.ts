import { calculateCallCost, costToCredits, type AiCallCost } from "@/lib/ai-pricing";
import { loadSkill, type MrThinkingLevel, type MarketResearchSkill } from "./skill-loader";
import { aiJsonParse } from "ai-json-safe-parse";

export const MR_DEFAULT_MODEL = "gemini-3.7-flash";

export interface GeminiRunOptions {
  stage: number;
  systemInstruction?: string;
  userPrompt: string;
  model?: string;
  overrideThinking?: MrThinkingLevel;
}

export interface GeminiRunResult<T = unknown> {
  data: T;
  rawText: string;
  cost: AiCallCost;
  credits: number;
  model: string;
  thinkingLevel: MrThinkingLevel;
}

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
      timeout: 180000,
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
      thinkingConfig: {
        thinkingLevel: levelMap[thinkingLevel] as any,
      },
    },
  });

  const rawText = response.text || "";
  let parsed: T;

  try {
    parsed = JSON.parse(rawText) as T;
  } catch {
    // Attempt robust recovery via aiJsonParse
    const recovered = aiJsonParse<T>(rawText);
    if (!recovered.success) {
      throw new Error(
        `Failed to parse structured JSON from Gemini 3.7 Flash output: ${rawText.slice(0, 300)}`
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

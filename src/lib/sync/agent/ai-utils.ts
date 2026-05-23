// Shared Gemini utilities for the sync agent: model selection, retry, JSON parse.

import { aiJsonParse } from "ai-json-safe-parse";
import { calculateCallCost, costToCredits } from "@/lib/ai-pricing";

export type SyncMode = "fast" | "pro";

/** Gemini 3 thinkingLevel — controls reasoning depth vs latency/cost.
 *  Maps to @google/genai ThinkingLevel enum values via resolveThinkingLevel(). */
export type SyncThinkingLevel = "low" | "medium" | "high";

export const MODELS: Record<SyncMode, string> = {
  fast: "gemini-3-flash-preview",
  pro: "gemini-3.1-pro-preview",
};

/** Resolve our string thinkingLevel to the @google/genai enum value the SDK
 *  accepts in `thinkingConfig.thinkingLevel`. Lazy-imports the SDK so this
 *  module stays cheap to load on cold paths. */
export async function resolveThinkingLevel(
  level: SyncThinkingLevel
): Promise<unknown> {
  const { ThinkingLevel } = await import("@google/genai");
  switch (level) {
    case "low":
      return ThinkingLevel.LOW;
    case "medium":
      return ThinkingLevel.MEDIUM;
    case "high":
      return ThinkingLevel.HIGH;
  }
}

export type SyncBillingTracker = {
  totalCredits: number;
  totalCost: number;
  totalTokens: number;
};

export function trackAiUsage(
  tracker: SyncBillingTracker | undefined,
  model: string,
  usageMetadata: unknown,
  usedGoogleSearch = false
): void {
  if (!tracker || !usageMetadata) return;
  const cost = calculateCallCost(model, usageMetadata, usedGoogleSearch);
  tracker.totalCost += cost.totalCost;
  tracker.totalTokens += cost.usage.totalTokens;
  tracker.totalCredits += costToCredits(cost.totalCost);
}

export async function withAiRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelay?: number; jitter?: number } = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelay ?? 1500;
  const jitter = opts.jitter ?? 500;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * jitter;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export function safeParseAiJson<T>(text: string): T {
  const parsed = aiJsonParse<T>(text);
  if (parsed.success) return parsed.data;
  throw new Error(`Failed to parse AI JSON output: ${parsed.error ?? "unknown"}`);
}

export function requireGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI service not configured (GEMINI_API_KEY missing)");
  return key;
}

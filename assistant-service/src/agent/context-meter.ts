import type { AssistantEvent } from "../../../src/lib/assistant/protocol";

type TurnUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

/** The subset of SDK `onDelta` updates the meter reads. */
export type SdkDeltaUpdate = { type: string; usage?: TurnUsage };

/**
 * Turns SDK delta updates into summary and context events.
 *
 * Usage arrives once per reply, summed over every model call in it, and each call
 * re-reads the whole conversation. Dividing the prompt tokens by the number of calls
 * approximates one call's prompt, which is the conversation size the window holds.
 */
export class ContextMeter {
  private modelCalls = 1;

  constructor(private readonly windowTokens: number) {}

  onUpdate(update: SdkDeltaUpdate): AssistantEvent[] {
    switch (update.type) {
      case "summary-started":
        return [{ type: "summary", status: "started" }];
      case "summary-completed":
        return [{ type: "summary", status: "completed" }];
      case "tool-requests-listed":
        this.modelCalls += 1;
        return [];
      case "turn-ended": {
        const usage = update.usage;
        const calls = this.modelCalls;
        this.modelCalls = 1;
        if (!usage) return [];
        const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
        if (prompt <= 0) return [];
        const usedTokens = Math.min(this.windowTokens, Math.round(prompt / calls + usage.outputTokens));
        return [{ type: "context", usedTokens, windowTokens: this.windowTokens }];
      }
      default:
        return [];
    }
  }
}

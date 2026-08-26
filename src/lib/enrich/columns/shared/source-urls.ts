import type { SourceUrl } from "@/types";
import type { ColumnSpec } from "../types";
import { boundedCount, promptLine } from "./helpers";

function sourceLimit(ctx: { col: { sourceCount?: number } }): number {
  return boundedCount(ctx.col.sourceCount, 3);
}

/**
 * Keep only model-cited URLs that exactly match a real tool citation, so the
 * stored sources can never be invented. Falls back to the tool pool.
 */
function pickSourcesFromSelection(
  selected: unknown,
  toolSources: SourceUrl[],
  limit: number
): SourceUrl[] {
  if (limit <= 0) return [];
  const byUri = new Map(toolSources.map((s) => [s.uri.toLowerCase(), s]));
  const out: SourceUrl[] = [];
  const seen = new Set<string>();

  if (Array.isArray(selected)) {
    for (const item of selected) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const uri = String(rec.uri || rec.url || "").trim();
      if (!/^https?:\/\//i.test(uri)) continue;
      const key = uri.toLowerCase();
      if (seen.has(key)) continue;
      const matched = byUri.get(key);
      if (!matched) continue;
      seen.add(key);
      out.push(matched);
      if (out.length >= limit) break;
    }
  }

  if (out.length === 0 && toolSources.length > 0) {
    return toolSources.slice(0, limit);
  }
  return out;
}

export const sourceUrlsSpec: ColumnSpec = {
  id: "sourceUrls",
  kinds: ["product", "plp"],
  needs: { search: true, sources: true },
  buildSchemaProperty(ctx) {
    return {
      type: "array",
      description:
        "Authoritative source pages from web search citations/sources only. Do not invent URLs.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          uri: { type: "string" },
        },
        required: ["title", "uri"],
      },
      maxItems: sourceLimit(ctx),
    };
  },
  buildPromptSection(ctx) {
    return promptLine(ctx, "Web sources used for this research.", [
      `sourceUrls are required: always use web_search; cite only real result URLs/titles (up to ${sourceLimit(
        ctx
      )}).`,
    ]);
  },
  parseValue(raw, ctx) {
    return pickSourcesFromSelection(raw, ctx.toolSources ?? [], sourceLimit(ctx));
  },
};

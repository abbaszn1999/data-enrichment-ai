// Website Restructure agent — three focused Gemini calls (vision → research →
// generation) instead of one call that mixes 11 images with 4 web searches,
// which would blow past the route's time budget and make the progress trace
// dishonest. Edits reuse the generation call with the current code attached.

import { aiJsonParse } from "ai-json-safe-parse";
import { calculateCallCost, calculateGroundedCallCost, type AiCallCost } from "@/lib/ai-pricing";
import { requireGeminiApiKey } from "@/lib/sync/agent/ai-utils";
import {
  WR_RECITATION_RETRY_HINT,
  WR_SKILL_INSTRUCTIONS,
  WR_VISION_INSTRUCTIONS,
} from "./skill";
import { taxonomyTreeToPromptText } from "./taxonomy-tree";
import type {
  WrBuildResult,
  WrChatMessage,
  WrCompetitorNote,
  WrDesignBrief,
  WrTaxonomyTree,
} from "./types";

export const WR_MODEL = "gemini-3.7-flash";

type InlineImage = { mimeType: string; data: string };
type GenerationPart = { text?: string; inlineData?: InlineImage };
type AttachedEditImage = InlineImage & { filename?: string };

async function getClient() {
  const apiKey = requireGeminiApiKey();
  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 180000 } });
}

async function mediumThinkingLevel() {
  const { ThinkingLevel } = await import("@google/genai");
  return ThinkingLevel.MEDIUM;
}

async function lowThinkingLevel() {
  const { ThinkingLevel } = await import("@google/genai");
  return ThinkingLevel.LOW;
}

const BRIEF_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["colors", "fontFamily", "headerHeight", "elements", "menuStyle", "textDirection", "notes"],
  properties: {
    colors: {
      type: "object",
      required: ["primary", "secondary", "background", "text"],
      properties: {
        primary: { type: "string", description: "Hex color, e.g. #111111" },
        secondary: { type: "string" },
        background: { type: "string" },
        text: { type: "string" },
      },
    },
    fontFamily: { type: "string", description: "A generic/system font stack, e.g. 'Inter, system-ui, sans-serif'" },
    headerHeight: { type: "string", description: "e.g. '72px'" },
    elements: {
      type: "array",
      items: { type: "string" },
      description: "Elements visible in the screenshots: logo, search bar, account icon, cart icon, announcement bar, mega menu, hamburger, language switcher, etc.",
    },
    menuStyle: { type: "string", description: "Short description of how the dropdown/mega menu is laid out in the screenshots." },
    textDirection: { type: "string", enum: ["ltr", "rtl"] },
    notes: { type: "string" },
  },
};

const BUILD_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["html", "css", "js", "notes"],
  properties: {
    html: { type: "string", description: "The header markup only — no <html>/<head>/<body> tags." },
    css: { type: "string", description: "CSS rules only — no <style> tags." },
    js: { type: "string", description: "Vanilla JS only — no <script> tags." },
    notes: { type: "string" },
  },
};

function safeJsonParse<T>(rawText: string): T {
  try {
    return JSON.parse(rawText) as T;
  } catch {
    const recovered = aiJsonParse<T>(rawText);
    if (!recovered.success) {
      throw new Error(`Failed to parse structured JSON from ${WR_MODEL} output: ${rawText.slice(0, 300)}`);
    }
    return recovered.data;
  }
}

export type WrVisionInput = {
  images: InlineImage[];
  logoImage: InlineImage | null;
  taxonomyTree: WrTaxonomyTree;
  storeLanguageHint?: string;
};

export async function runVisionBrief(
  input: WrVisionInput
): Promise<{ brief: WrDesignBrief; cost: AiCallCost }> {
  const ai = await getClient();

  const promptLines = [
    `Analyze the ${input.images.length} attached screenshot${input.images.length === 1 ? "" : "s"} of this store's current header (some may show an opened dropdown/mega menu)${
      input.logoImage ? ", plus the store's logo image, which is attached last and labeled" : ""
    }.`,
    "Extract a structured design brief that another engineer will use to rebuild this header from scratch.",
    input.logoImage
      ? "The logo image is the store's own logo — read its colors and shape, but do not describe it as a separate header element beyond the logo itself."
      : "No logo image was provided.",
    input.storeLanguageHint ? `Store language/market hint: ${input.storeLanguageHint}.` : "",
    "",
    "This store's categories, for context on how large the menu has to be (not a list of visible elements):",
    taxonomyTreeToPromptText(input.taxonomyTree),
  ].filter(Boolean);

  // Each image gets its own label part: unlabeled inline images arrive as an
  // anonymous blob sequence, so the model cannot tell the last one is the logo
  // rather than one more header screenshot.
  type Part = { text?: string; inlineData?: InlineImage };
  const parts: Part[] = [{ text: promptLines.join("\n") }];
  input.images.forEach((img, i) => {
    parts.push({ text: `HEADER SCREENSHOT ${i + 1} of ${input.images.length}:` });
    parts.push({ inlineData: img });
  });
  if (input.logoImage) {
    parts.push({ text: "STORE LOGO IMAGE:" });
    parts.push({ inlineData: input.logoImage });
  }

  const response = await ai.models.generateContent({
    model: WR_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: WR_VISION_INSTRUCTIONS,
      responseMimeType: "application/json",
      responseJsonSchema: BRIEF_SCHEMA,
      thinkingConfig: { thinkingLevel: await mediumThinkingLevel() },
    },
  });

  const rawText = response.text || "{}";
  const brief = safeJsonParse<WrDesignBrief>(rawText);
  const cost = calculateCallCost(WR_MODEL, response.usageMetadata);
  return { brief, cost };
}

/** One web-search call per competitor — grounding and JSON output mode
 *  cannot be combined reliably, so this returns short plain text and the
 *  caller wraps it, mirroring `searchProduct` in `lib/gemini.ts`. */
export async function runCompetitorResearch(input: {
  competitor: string;
}): Promise<{ note: WrCompetitorNote; cost: AiCallCost }> {
  const ai = await getClient();

  const prompt = [
    `Look up this competitor storefront: "${input.competitor}".`,
    "Reply in exactly this two-line plain text format, nothing else:",
    "Name: <the store/brand's real name>",
    "Summary: <2-3 sentences on how their header/navigation is structured — what's in it, how the mega menu is organized, anything a header designer should borrow or avoid>",
  ].join("\n");

  const response = await ai.models.generateContent({
    model: WR_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      tools: [{ googleSearch: {} }],
      // Two lines of prose off a web search does not need the default thinking
      // budget, which otherwise costs several times the answer itself.
      thinkingConfig: { thinkingLevel: await lowThinkingLevel() },
    },
  });

  const text = response.text || "";
  const nameMatch = /Name:\s*(.+)/i.exec(text);
  const summaryMatch = /Summary:\s*([\s\S]+)/i.exec(text);

  const executedQueries =
    response.candidates?.[0]?.groundingMetadata?.webSearchQueries?.filter(
      (q) => typeof q === "string" && q.trim()
    ).length ?? 1;
  const cost = calculateGroundedCallCost(WR_MODEL, response.usageMetadata, Math.max(executedQueries, 1));

  return {
    note: {
      input: input.competitor,
      resolvedName: nameMatch?.[1]?.trim() || input.competitor,
      summary: summaryMatch?.[1]?.trim() || text.trim() || "No summary available.",
    },
    cost,
  };
}

type GenerationAttempt = { rawText: string; usageMetadata: unknown; finishReason: string };

async function streamGeneration(input: {
  systemInstruction: string;
  userPrompt: string;
  images?: AttachedEditImage[];
}): Promise<GenerationAttempt> {
  const ai = await getClient();

  const parts: GenerationPart[] = [{ text: input.userPrompt }];
  for (const [i, img] of (input.images ?? []).entries()) {
    const name = img.filename?.trim();
    parts.push({ text: name ? `ATTACHED IMAGE ${i + 1} (${name}):` : `ATTACHED IMAGE ${i + 1}:` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  const stream = await ai.models.generateContentStream({
    model: WR_MODEL,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: input.systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: BUILD_RESULT_SCHEMA,
      thinkingConfig: { thinkingLevel: await mediumThinkingLevel() },
    },
  });

  let rawText = "";
  let usageMetadata: unknown;
  let finishReason = "";
  for await (const chunk of stream) {
    if (chunk.text) rawText += chunk.text;
    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
    const reason = chunk.candidates?.[0]?.finishReason;
    if (reason) finishReason = String(reason);
  }

  return { rawText, usageMetadata, finishReason };
}

/**
 * A stream that ended for any reason other than STOP was cut mid-JSON, so its
 * partial text must be rejected outright — `aiJsonParse` is lenient enough to
 * "recover" a truncated object, which would otherwise save a half-written
 * header as a real version. The dominant cause is RECITATION (the copyright
 * filter tripping on well-known icon path data).
 */
function parseCompleteBuildResult(attempt: GenerationAttempt): WrBuildResult | null {
  if (attempt.finishReason && attempt.finishReason.toUpperCase() !== "STOP") return null;
  if (!attempt.rawText.trim()) return null;
  try {
    const result = safeJsonParse<WrBuildResult>(attempt.rawText);
    return result.html?.trim() ? result : null;
  } catch {
    return null;
  }
}

function addCosts(a: AiCallCost, b: AiCallCost): AiCallCost {
  return {
    ...a,
    usage: {
      promptTokens: a.usage.promptTokens + b.usage.promptTokens,
      candidatesTokens: a.usage.candidatesTokens + b.usage.candidatesTokens,
      thoughtsTokens: a.usage.thoughtsTokens + b.usage.thoughtsTokens,
      cachedTokens: a.usage.cachedTokens + b.usage.cachedTokens,
      cacheWriteTokens: a.usage.cacheWriteTokens + b.usage.cacheWriteTokens,
      totalTokens: a.usage.totalTokens + b.usage.totalTokens,
    },
    usedGoogleSearch: a.usedGoogleSearch || b.usedGoogleSearch,
    inputCost: a.inputCost + b.inputCost,
    cachedInputCost: a.cachedInputCost + b.cachedInputCost,
    cacheWriteCost: a.cacheWriteCost + b.cacheWriteCost,
    outputCost: a.outputCost + b.outputCost,
    searchCost: a.searchCost + b.searchCost,
    serperCost: a.serperCost + b.serperCost,
    serpApiCost: a.serpApiCost + b.serpApiCost,
    totalCost: a.totalCost + b.totalCost,
  };
}

async function runGenerationCall(input: {
  systemInstruction: string;
  userPrompt: string;
  images?: AttachedEditImage[];
}): Promise<{ result: WrBuildResult; cost: AiCallCost }> {
  const first = await streamGeneration(input);
  let cost = calculateCallCost(WR_MODEL, first.usageMetadata);

  const firstResult = parseCompleteBuildResult(first);
  if (firstResult) return { result: firstResult, cost };

  console.warn(
    `[website-restructure] generation attempt cut short (finishReason=${
      first.finishReason || "unknown"
    }); retrying with the simple-icon guard`
  );

  const second = await streamGeneration({
    systemInstruction: input.systemInstruction,
    userPrompt: `${input.userPrompt}\n\n${WR_RECITATION_RETRY_HINT}`,
    images: input.images,
  });
  cost = addCosts(cost, calculateCallCost(WR_MODEL, second.usageMetadata));

  const secondResult = parseCompleteBuildResult(second);
  if (secondResult) return { result: secondResult, cost };

  const reason = second.finishReason || first.finishReason || "unknown";
  throw new Error(
    reason.toUpperCase() === "RECITATION"
      ? "The header code kept getting blocked by the model's copyright filter, twice in a row. Please try building again."
      : `The header could not be generated — the model stopped early (${reason}). Please try again.`
  );
}

export async function runGeneration(input: {
  brief: WrDesignBrief;
  competitorNotes: WrCompetitorNote[];
  taxonomyTree: WrTaxonomyTree;
}): Promise<{ result: WrBuildResult; cost: AiCallCost }> {
  const userPrompt = [
    "Build this store's header now, from scratch.",
    "",
    "You are given three context blocks. When they disagree, this is the order of authority:",
    "1. STORE CATEGORIES decide WHAT the header says. Every nav item and menu entry must",
    "   come from this store's real category names. This header belongs to this store.",
    "2. DESIGN BRIEF decides HOW it looks — colors, font stack, header height, menu layout.",
    "   Ignore any element the brief lists that makes no sense for a store selling these",
    "   categories (e.g. \"Book a demo\", \"Start for free\", \"Platform\", \"Pricing\", a",
    "   theme switcher): those come from misreading the screenshots, not from the store.",
    "3. COMPETITOR NOTES are loose inspiration for structure only. Never reuse their",
    "   category names, wording, or brand.",
    "",
    "DESIGN BRIEF:",
    JSON.stringify(input.brief, null, 2),
    "",
    "COMPETITOR NOTES (optional inspiration, do not copy verbatim):",
    input.competitorNotes.length > 0
      ? input.competitorNotes.map((n) => `- ${n.resolvedName}: ${n.summary}`).join("\n")
      : "(none provided)",
    "",
    "STORE CATEGORIES (the nav labels to use — every href you output is still exactly \"#\", never a real link):",
    taxonomyTreeToPromptText(input.taxonomyTree),
  ].join("\n");

  return runGenerationCall({ systemInstruction: WR_SKILL_INSTRUCTIONS, userPrompt });
}

export async function runEdit(input: {
  brief: WrDesignBrief;
  currentResult: WrBuildResult;
  taxonomyTree: WrTaxonomyTree;
  recentChat: WrChatMessage[];
  instruction: string;
  images?: AttachedEditImage[];
}): Promise<{ result: WrBuildResult; cost: AiCallCost }> {
  const historyText = input.recentChat
    .slice(-6)
    .map((m) => {
      const extra = m.attachments?.length ? ` [${m.attachments.length} image(s) attached]` : "";
      return `${m.role.toUpperCase()}: ${m.text}${extra}`;
    })
    .join("\n");

  const attached = input.images ?? [];
  const userPrompt = [
    "You previously built this header. Apply the requested edit and return the FULL updated html/css/js again (not a diff).",
    "",
    "DESIGN BRIEF (keep consistent with this unless the edit explicitly changes it):",
    JSON.stringify(input.brief, null, 2),
    "",
    "STORE CATEGORIES (the nav labels to use — every href you output is still exactly \"#\", never a real link):",
    taxonomyTreeToPromptText(input.taxonomyTree),
    "",
    "CURRENT HTML:",
    input.currentResult.html,
    "",
    "CURRENT CSS:",
    input.currentResult.css,
    "",
    "CURRENT JS:",
    input.currentResult.js,
    "",
    historyText ? `RECENT CONVERSATION:\n${historyText}\n` : "",
    attached.length > 0
      ? [
          `ATTACHED REFERENCE IMAGES: ${attached.length} image(s) follow this prompt, labeled ATTACHED IMAGE 1..${attached.length}.`,
          "They are ground truth for this edit:",
          "- Logo: keep src=\"{{WR_LOGO_SRC}}\". Do not embed the image as base64 or a URL — the platform will swap the logo file.",
          "- Palette / colors: read the actual hex values off the image and apply them in CSS.",
          "- Screenshot or mock: match layout, spacing, and colors as closely as the header skill allows.",
          "Never invent URLs. Never put attached image bytes into the HTML.",
          "",
        ].join("\n")
      : "",
    `REQUESTED EDIT: ${input.instruction}`,
  ].join("\n");

  return runGenerationCall({
    systemInstruction: WR_SKILL_INSTRUCTIONS,
    userPrompt,
    images: attached.length > 0 ? attached : undefined,
  });
}

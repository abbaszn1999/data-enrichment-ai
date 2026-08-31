import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiCallCost } from "@/lib/ai-pricing";
import type { WrDesignBrief, WrTaxonomyTree } from "./types";

const generateContent = vi.hoisted(() => vi.fn());
const generateContentStream = vi.hoisted(() => vi.fn());
const calculateCallCostMock = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream };
  },
  ThinkingLevel: { MEDIUM: "MEDIUM", LOW: "LOW" },
}));

vi.mock("@/lib/ai-pricing", () => ({
  calculateCallCost: (...args: unknown[]) => calculateCallCostMock(...args),
  calculateGroundedCallCost: (...args: unknown[]) => calculateCallCostMock(...args),
}));

const { runEdit, runGeneration, runVisionBrief } = await import("./agent");
const { WR_SKILL_INSTRUCTIONS, WR_VISION_INSTRUCTIONS } = await import("./skill");

function cost(totalCost: number): AiCallCost {
  return {
    model: "gemini-3.7-flash",
    usage: {
      promptTokens: 10,
      candidatesTokens: 10,
      thoughtsTokens: 10,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 30,
    },
    usedGoogleSearch: false,
    inputCost: 0,
    cachedInputCost: 0,
    cacheWriteCost: 0,
    outputCost: 0,
    searchCost: 0,
    serperCost: 0,
    serpApiCost: 0,
    totalCost,
  };
}

/** Queues one streamed generation: chunks of text plus the finishReason the
 *  server-side stream reports on its last chunk. */
function queueStream(text: string, finishReason: string) {
  generateContentStream.mockResolvedValueOnce(
    (async function* () {
      yield { text, candidates: [{ finishReason }], usageMetadata: {} };
    })()
  );
}

const HEADER_JSON = JSON.stringify({
  html: "<header><a href='#'>Smartphones</a></header>",
  css: ".x{}",
  js: "",
  notes: "Built it.",
});

const brief: WrDesignBrief = {
  colors: { primary: "#000", secondary: "#111", background: "#fff", text: "#000" },
  fontFamily: "system-ui, sans-serif",
  headerHeight: "64px",
  elements: ["logo"],
  menuStyle: "simple",
  textDirection: "ltr",
  notes: "",
};

const tree: WrTaxonomyTree = {
  navigation: null,
  topTaxonomies: [{ id: "1", title: "Smartphones", productCount: 6, children: [] }],
  overflowCount: 0,
};

beforeEach(() => {
  generateContent.mockReset();
  generateContentStream.mockReset();
  calculateCallCostMock.mockReset();
  calculateCallCostMock.mockReturnValue(cost(0.001));
  process.env.GEMINI_API_KEY = "test-key";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("runGeneration", () => {
  it("returns the result without a second call when the first attempt completes", async () => {
    queueStream(HEADER_JSON, "STOP");

    const { result } = await runGeneration({ brief, competitorNotes: [], taxonomyTree: tree });

    expect(result.notes).toBe("Built it.");
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it("retries with the simple-icon hint when the copyright filter cuts the first attempt off", async () => {
    // A RECITATION cut arrives as syntactically broken, half-written JSON.
    queueStream('{"html": "<header><svg><path d="M5.23 7.21a.75', "RECITATION");
    queueStream(HEADER_JSON, "STOP");

    const { result } = await runGeneration({ brief, competitorNotes: [], taxonomyTree: tree });

    expect(result.notes).toBe("Built it.");
    expect(generateContentStream).toHaveBeenCalledTimes(2);
    const retryPrompt = generateContentStream.mock.calls[1][0].contents[0].parts[0].text;
    expect(retryPrompt).toContain("cut off by the copyright filter");
    expect(retryPrompt).toContain("No <path> curve data");
  });

  it("never accepts a cut-off attempt, even when the partial JSON is recoverable", async () => {
    // Lenient JSON recovery would happily hand back this half-written header,
    // which would then be saved as a real version of the merchant's header.
    queueStream('{"html": "<header>truncated', "RECITATION");
    queueStream(HEADER_JSON, "STOP");

    const { result } = await runGeneration({ brief, competitorNotes: [], taxonomyTree: tree });

    expect(result.html).not.toContain("truncated");
  });

  it("bills both attempts when it has to retry", async () => {
    queueStream("", "RECITATION");
    queueStream(HEADER_JSON, "STOP");

    const { cost: billed } = await runGeneration({ brief, competitorNotes: [], taxonomyTree: tree });

    expect(billed.totalCost).toBeCloseTo(0.002);
    expect(billed.usage.totalTokens).toBe(60);
  });

  it("fails with an actionable message when both attempts are cut off", async () => {
    queueStream("", "RECITATION");
    queueStream("", "RECITATION");

    await expect(
      runGeneration({ brief, competitorNotes: [], taxonomyTree: tree })
    ).rejects.toThrow(/copyright filter/i);
  });

  it("reports the stop reason when the model ends early for another reason", async () => {
    queueStream("", "MAX_TOKENS");
    queueStream("", "MAX_TOKENS");

    await expect(
      runGeneration({ brief, competitorNotes: [], taxonomyTree: tree })
    ).rejects.toThrow(/MAX_TOKENS/);
  });

  it("tells the agent the store's own categories outrank the brief's elements", async () => {
    queueStream(HEADER_JSON, "STOP");

    await runGeneration({ brief, competitorNotes: [], taxonomyTree: tree });

    const prompt = generateContentStream.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain("order of authority");
    expect(prompt).toContain("Book a demo");
    expect(generateContentStream.mock.calls[0][0].config.systemInstruction).toBe(
      WR_SKILL_INSTRUCTIONS
    );
  });
});

describe("runEdit", () => {
  const currentResult = { html: "<header></header>", css: "", js: "", notes: "" };

  it("sends only the text prompt when no images are attached", async () => {
    queueStream(HEADER_JSON, "STOP");

    await runEdit({
      brief,
      currentResult,
      taxonomyTree: tree,
      recentChat: [],
      instruction: "make the bar green",
    });

    const parts = generateContentStream.mock.calls[0][0].contents[0].parts as Array<{
      text?: string;
      inlineData?: unknown;
    }>;
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toContain("REQUESTED EDIT: make the bar green");
    expect(parts.some((p) => p.inlineData)).toBe(false);
  });

  it("labels each attached image so the model can tell them apart", async () => {
    queueStream(HEADER_JSON, "STOP");

    await runEdit({
      brief,
      currentResult,
      taxonomyTree: tree,
      recentChat: [],
      instruction: "use this as the logo",
      images: [{ mimeType: "image/png", data: "logo-bytes", filename: "logo.png" }],
    });

    const parts = generateContentStream.mock.calls[0][0].contents[0].parts as Array<{
      text?: string;
      inlineData?: { data: string };
    }>;
    expect(parts[0].text).toContain("ATTACHED REFERENCE IMAGES");
    expect(parts[0].text).toContain("{{WR_LOGO_SRC}}");
    expect(parts.some((p) => p.text === "ATTACHED IMAGE 1 (logo.png):")).toBe(true);
    expect(parts.filter((p) => p.inlineData).map((p) => p.inlineData!.data)).toEqual(["logo-bytes"]);
  });

  it("keeps attached images on the recitation retry", async () => {
    queueStream("", "RECITATION");
    queueStream(HEADER_JSON, "STOP");

    await runEdit({
      brief,
      currentResult,
      taxonomyTree: tree,
      recentChat: [],
      instruction: "extract these colors",
      images: [{ mimeType: "image/png", data: "palette", filename: "swatches.png" }],
    });

    expect(generateContentStream).toHaveBeenCalledTimes(2);
    const retryParts = generateContentStream.mock.calls[1][0].contents[0].parts as Array<{
      inlineData?: { data: string };
    }>;
    expect(retryParts.filter((p) => p.inlineData).map((p) => p.inlineData!.data)).toEqual(["palette"]);
  });
});

describe("runVisionBrief", () => {
  const img = (data: string) => ({ mimeType: "image/png", data });

  beforeEach(() => {
    generateContent.mockResolvedValue({ text: JSON.stringify(brief), usageMetadata: {} });
  });

  it("labels each screenshot and the logo so the model can tell them apart", async () => {
    await runVisionBrief({
      images: [img("a"), img("b")],
      logoImage: img("logo"),
      taxonomyTree: tree,
    });

    const parts = generateContent.mock.calls[0][0].contents[0].parts as Array<{
      text?: string;
      inlineData?: { data: string };
    }>;
    const labels = parts.map((p) => p.text).filter(Boolean);
    expect(labels).toContain("HEADER SCREENSHOT 1 of 2:");
    expect(labels).toContain("HEADER SCREENSHOT 2 of 2:");
    expect(labels).toContain("STORE LOGO IMAGE:");
    // Every uploaded image really is attached, logo last.
    expect(parts.filter((p) => p.inlineData).map((p) => p.inlineData!.data)).toEqual([
      "a",
      "b",
      "logo",
    ]);
  });

  it("uses the vision instruction, not the code-writing skill", async () => {
    await runVisionBrief({ images: [img("a")], logoImage: null, taxonomyTree: tree });

    const config = generateContent.mock.calls[0][0].config;
    expect(config.systemInstruction).toBe(WR_VISION_INSTRUCTIONS);
    expect(config.systemInstruction).not.toContain("{{WR_LOGO_SRC}}");
  });

  it("says plainly that no logo was provided rather than leaving it ambiguous", async () => {
    await runVisionBrief({ images: [img("a")], logoImage: null, taxonomyTree: tree });

    const parts = generateContent.mock.calls[0][0].contents[0].parts as Array<{ text?: string }>;
    expect(parts[0].text).toContain("No logo image was provided.");
    expect(parts.some((p) => p.text === "STORE LOGO IMAGE:")).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiCallCost } from "@/lib/ai-pricing";
import type { WrDesignBrief, WrNavPlan, WrTaxonomyTree } from "./types";

const generateContent = vi.hoisted(() => vi.fn());
const generateContentStream = vi.hoisted(() => vi.fn());
const calculateCallCostMock = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream };
  },
  ThinkingLevel: { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" },
}));

vi.mock("@/lib/ai-pricing", () => ({
  calculateCallCost: (...args: unknown[]) => calculateCallCostMock(...args),
  calculateGroundedCallCost: (...args: unknown[]) => calculateCallCostMock(...args),
}));

const { runEdit, runGeneration, runIaPlan, runVisionBrief } = await import("./agent");
const { loadWrSkill } = await import("./skill-loader");

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
  // Tagged as a brand so it forms a real digest cluster on its own (a lone
  // non-brand item never clears the "shared by >=2 PLPs" bar a topic cluster
  // needs — see `plp-clustering.ts`).
  allTaxonomies: [
    { id: "1", title: "Smartphones", productCount: 6, children: [], source: "store", kind: "brand" },
  ],
};

const emptyNavPlan: WrNavPlan = {
  nodes: [],
  maxDepth: 0,
  coverage: { totalClusters: 0, coveredClusters: 0, orphanedClusterRefs: [] },
  generatedAt: new Date(0).toISOString(),
};

const filledNavPlan: WrNavPlan = {
  nodes: [
    {
      id: "smartphones",
      label: "Smartphones",
      level: "department",
      clusterRefs: ["brand:smartphones"],
      plpCount: 1,
      productCount: 6,
      children: [],
    },
  ],
  maxDepth: 1,
  coverage: { totalClusters: 1, coveredClusters: 1, orphanedClusterRefs: [] },
  generatedAt: new Date(0).toISOString(),
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

    const { result } = await runGeneration({
      brief,
      competitorNotes: [],
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [],
      logoImage: null,
    });

    expect(result.notes).toBe("Built it.");
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it("retries with the simple-icon hint when the copyright filter cuts the first attempt off", async () => {
    // A RECITATION cut arrives as syntactically broken, half-written JSON.
    queueStream('{"html": "<header><svg><path d="M5.23 7.21a.75', "RECITATION");
    queueStream(HEADER_JSON, "STOP");

    const { result } = await runGeneration({
      brief,
      competitorNotes: [],
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [],
      logoImage: null,
    });

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

    const { result } = await runGeneration({
      brief,
      competitorNotes: [],
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [],
      logoImage: null,
    });

    expect(result.html).not.toContain("truncated");
  });

  it("bills both attempts when it has to retry", async () => {
    queueStream("", "RECITATION");
    queueStream(HEADER_JSON, "STOP");

    const { cost: billed } = await runGeneration({
      brief,
      competitorNotes: [],
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [],
      logoImage: null,
    });

    expect(billed.totalCost).toBeCloseTo(0.002);
    expect(billed.usage.totalTokens).toBe(60);
  });

  it("fails with an actionable message when both attempts are cut off", async () => {
    queueStream("", "RECITATION");
    queueStream("", "RECITATION");

    await expect(
      runGeneration({
        brief,
        competitorNotes: [],
        taxonomyTree: tree,
        navPlan: filledNavPlan,
        headerScreenshots: [],
        logoImage: null,
      })
    ).rejects.toThrow(/copyright filter/i);
  });

  it("reports the stop reason when the model ends early for another reason", async () => {
    queueStream("", "MAX_TOKENS");
    queueStream("", "MAX_TOKENS");

    await expect(
      runGeneration({
        brief,
        competitorNotes: [],
        taxonomyTree: tree,
        navPlan: filledNavPlan,
        headerScreenshots: [],
        logoImage: null,
      })
    ).rejects.toThrow(/MAX_TOKENS/);
  });

  it("tells the agent the nav plan outranks the brief's elements, and uses the header-builder skill", async () => {
    queueStream(HEADER_JSON, "STOP");

    await runGeneration({
      brief,
      competitorNotes: [],
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [],
      logoImage: null,
    });

    const prompt = generateContentStream.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain("order of authority");
    expect(prompt).toContain("Book a demo");
    expect(prompt).toContain("Smartphones"); // from the nav plan, not the raw taxonomy tree

    const headerBuilderSkill = await loadWrSkill("header-builder");
    expect(generateContentStream.mock.calls[0][0].config.systemInstruction).toBe(headerBuilderSkill.instructions);
  });

  it("sends the original header screenshots and logo image to the model", async () => {
    queueStream(HEADER_JSON, "STOP");

    await runGeneration({
      brief,
      competitorNotes: [],
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [{ mimeType: "image/png", data: "shot-1" }],
      logoImage: { mimeType: "image/png", data: "logo-bytes" },
    });

    const parts = generateContentStream.mock.calls[0][0].contents[0].parts as Array<{
      text?: string;
      inlineData?: { data: string };
    }>;
    expect(parts.some((p) => p.text?.includes("ORIGINAL HEADER SCREENSHOT"))).toBe(true);
    expect(parts.filter((p) => p.inlineData).map((p) => p.inlineData!.data)).toEqual(["shot-1", "logo-bytes"]);
  });

  it("falls back to the raw taxonomy tree text when no nav plan entries exist", async () => {
    queueStream(HEADER_JSON, "STOP");

    await runGeneration({
      brief,
      competitorNotes: [],
      taxonomyTree: tree,
      navPlan: emptyNavPlan,
      headerScreenshots: [],
      logoImage: null,
    });

    const prompt = generateContentStream.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain("no nav plan was available");
    expect(prompt).toContain("Smartphones");
  });
});

describe("runEdit", () => {
  const currentResult = { html: "<header></header>", css: "", js: "", notes: "" };

  it("sends the text prompt plus original screenshots/logo, and no attachments when none provided", async () => {
    queueStream(HEADER_JSON, "STOP");

    await runEdit({
      brief,
      currentResult,
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [],
      logoImage: null,
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
      navPlan: filledNavPlan,
      headerScreenshots: [],
      logoImage: null,
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

  it("sends the original header screenshots and logo alongside any new attachments", async () => {
    queueStream(HEADER_JSON, "STOP");

    await runEdit({
      brief,
      currentResult,
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [{ mimeType: "image/png", data: "original-shot" }],
      logoImage: { mimeType: "image/png", data: "original-logo" },
      recentChat: [],
      instruction: "make it bolder",
    });

    const parts = generateContentStream.mock.calls[0][0].contents[0].parts as Array<{
      text?: string;
      inlineData?: { data: string };
    }>;
    expect(parts.some((p) => p.text?.includes("ORIGINAL HEADER SCREENSHOT"))).toBe(true);
    expect(parts.filter((p) => p.inlineData).map((p) => p.inlineData!.data)).toEqual([
      "original-shot",
      "original-logo",
    ]);
  });

  it("keeps attached images on the recitation retry", async () => {
    queueStream("", "RECITATION");
    queueStream(HEADER_JSON, "STOP");

    await runEdit({
      brief,
      currentResult,
      taxonomyTree: tree,
      navPlan: filledNavPlan,
      headerScreenshots: [],
      logoImage: null,
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

  it("uses the vision skill, not the header-builder skill", async () => {
    await runVisionBrief({ images: [img("a")], logoImage: null, taxonomyTree: tree });

    const config = generateContent.mock.calls[0][0].config;
    const visionSkill = await loadWrSkill("vision");
    expect(config.systemInstruction).toBe(visionSkill.instructions);
    expect(config.systemInstruction).not.toContain("{{WR_LOGO_SRC}}");
  });

  it("says plainly that no logo was provided rather than leaving it ambiguous", async () => {
    await runVisionBrief({ images: [img("a")], logoImage: null, taxonomyTree: tree });

    const parts = generateContent.mock.calls[0][0].contents[0].parts as Array<{ text?: string }>;
    expect(parts[0].text).toContain("No logo image was provided.");
    expect(parts.some((p) => p.text === "STORE LOGO IMAGE:")).toBe(false);
  });
});

describe("runIaPlan", () => {
  function queueNavPlanResponse(nodes: unknown[]) {
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({ nodes }),
      usageMetadata: {},
    });
  }

  it("uses the ia-planner skill and returns the model's elected tree when it's already valid", async () => {
    queueNavPlanResponse([
      {
        id: "smartphones",
        label: "Smartphones",
        level: "department",
        clusterRefs: ["brand:smartphones"],
        children: [],
      },
    ]);

    const { plan } = await runIaPlan({ taxonomyTree: tree, brief, competitorNotes: [] });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const iaSkill = await loadWrSkill("ia-planner");
    expect(generateContent.mock.calls[0][0].config.systemInstruction).toBe(iaSkill.instructions);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0].label).toBe("Smartphones");
    expect(plan.coverage.orphanedClusterRefs).toEqual([]);
  });

  it("retries once and then deterministically flattens when the model exceeds the 3-click depth budget", async () => {
    const tooDeep = [
      {
        id: "d",
        label: "Department",
        level: "department",
        clusterRefs: [],
        children: [
          {
            id: "c",
            label: "Category",
            level: "category",
            clusterRefs: [],
            children: [
              {
                id: "s",
                label: "Subcategory",
                level: "subcategory",
                clusterRefs: [],
                children: [
                  {
                    id: "s2",
                    label: "Too Deep",
                    level: "subcategory",
                    clusterRefs: ["brand:smartphones"],
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    queueNavPlanResponse(tooDeep);
    queueNavPlanResponse(tooDeep); // model still gets it wrong on retry

    const { plan } = await runIaPlan({ taxonomyTree: tree, brief, competitorNotes: [] });

    expect(generateContent).toHaveBeenCalledTimes(2);
    const retryPrompt = generateContent.mock.calls[1][0].contents[0].parts[0].text;
    expect(retryPrompt).toContain("deeper than 3 levels");
    expect(plan.maxDepth).toBeLessThanOrEqual(3);
  });

  it("folds any uncovered cluster into a generated catch-all node instead of dropping it", async () => {
    // The model's tree references nothing — every cluster in the digest is orphaned.
    queueNavPlanResponse([]);

    const { plan } = await runIaPlan({ taxonomyTree: tree, brief, competitorNotes: [] });

    const catchAll = plan.nodes.find((n) => n.id === "more-categories");
    expect(catchAll).toBeTruthy();
    expect(catchAll?.clusterRefs).toContain("brand:smartphones");
  });

  it("skips the model call entirely when there is no catalog to plan over", async () => {
    // Snapshots saved before `allTaxonomies` existed look like this, as does a
    // store with no PLPs. An empty plan makes the builder fall back to the
    // taxonomy tree text.
    const emptyTree: WrTaxonomyTree = { navigation: null, topTaxonomies: [], overflowCount: 0, allTaxonomies: [] };

    const { plan } = await runIaPlan({ taxonomyTree: emptyTree, brief, competitorNotes: [] });

    expect(generateContent).not.toHaveBeenCalled();
    expect(plan.nodes).toEqual([]);
  });
});

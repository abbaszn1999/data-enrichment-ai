import type {
  MockCollection,
  MockNiche,
  MockSeedRow,
  NicheReading,
} from "@/components/market-research/mock-data";
import type { StoreCollectionItem } from "./store-catalog";
import { runGeminiMarketResearch } from "./gemini-runner";

export type Stage1ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type Stage1ChatResult = {
  reply: string;
  updatedNiches?: NicheReading[];
  updatedStructuredNiches?: MockNiche[];
};

export type AgentChatInput = {
  stage?: number;
  market?: string;
  storeName: string;
  collections: StoreCollectionItem[];
  currentNiches: NicheReading[];
  currentStructuredNiches?: MockNiche[];
  selectedCollectionIds?: string[];
  seedRows?: MockSeedRow[];
  probes?: Record<
    string,
    { volume?: string; rawKeywordCount?: number; cpc?: string; failed?: boolean }
  >;
  messages: Stage1ChatMessage[];
  userMessage: string;
};

interface GeminiChatResponse {
  reply: string;
  nichesUpdated?: boolean;
  updatedNiches?: Array<{
    id?: string;
    name: string;
    summary?: string;
    collectionIds: string[];
  }>;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "niche";
}

export async function runStage1AgentChat(
  input: AgentChatInput
): Promise<Stage1ChatResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const currentStage = input.stage ?? 1;

  if (!apiKey) {
    return {
      reply: `I received your message: "${input.userMessage}". In live mode with GEMINI_API_KEY, I will respond interactively with full awareness of Stage ${currentStage}.`,
    };
  }

  // Build stage-specific description and screen state
  let stageName = "Stage 1: Store Scope & Niche Discovery";
  let stageGoal = "Analyze website structure, categorize collections, and discover broad parent niches.";
  let screenContext = "";

  if (currentStage === 1) {
    stageName = "Stage 1: Store Scope & Niche Discovery";
    stageGoal = "The agent scanned the store and organized all collections under broad parent niches. The merchant can review, discuss, or modify these parent niches.";
    screenContext = `CURRENT RIGHT PANEL VIEW (Stage 1 - Discovered Parent Niches):
${input.currentNiches.map((n) => `- ${n.name}: ${n.summary}`).join("\n")}
Total Catalog Collections Available: ${input.collections.length} collections (${input.collections.reduce((sum, c) => sum + c.productCount, 0)} products).`;
  } else if (currentStage === 2) {
    stageName = "Stage 2: Catalog Scope Selection";
    stageGoal = "The merchant selects which existing website collections or broad niches to include in the market research analysis.";
    const selectedSet = new Set(input.selectedCollectionIds ?? []);
    const selectedCollectionsList = input.collections.filter((c) =>
      selectedSet.has(c.id)
    );

    screenContext = `CURRENT RIGHT PANEL VIEW (Stage 2 - Catalog Scope Selection):
Available Niches & Collections:
${(input.currentStructuredNiches ?? [])
  .map(
    (n) =>
      `• Niche: ${n.name} (${n.productCount} products)\n  Collections: ${n.collections
        .map(
          (c) =>
            `${c.name} [${c.productCount} items]${selectedSet.has(c.id) ? " (SELECTED)" : ""}`
        )
        .join(", ")}`
  )
  .join("\n")}

Selected Scope by Merchant: ${
      selectedCollectionsList.length > 0
        ? `${selectedCollectionsList.length} collections selected (${selectedCollectionsList.map((c) => c.name).join(", ")})`
        : "No collections selected yet (merchant is choosing checkboxes)"
    }`;
  } else if (currentStage === 3) {
    stageName = "Stage 3: Broad Niche Seed Terms & Demand Probing";
    stageGoal = "The agent generated broad commercial search terms (seed variations) for all selected collections. The merchant can review the seed table and probe initial search demand.";
    
    const totalSeeds = input.seedRows?.length ?? 0;
    const sampleRows = (input.seedRows ?? []).slice(0, 15).map((r) => {
      const probe = input.probes?.[r.id];
      const probeStr = probe?.volume
        ? ` -> Volume: ${probe.volume}, Raw Keywords: ${probe.rawKeywordCount ?? "N/A"}`
        : " -> Not probed yet";
      return `• [${r.selectedCollection}] "${r.broadSeedVariation}" (Canonical: "${r.canonicalNicheSeed}", Type: ${r.variationType}, Scope: ${r.scopeMatch})${probeStr}`;
    });

    screenContext = `CURRENT RIGHT PANEL VIEW (Stage 3 - Seed Terms Table & Demand Probing):
Target Market: ${input.market || "United States - English"}
Total Seed Rows Generated: ${totalSeeds} rows across selected collections.
Sample of Visible Seeds in Table:
${sampleRows.join("\n")}
${totalSeeds > 15 ? `... and ${totalSeeds - 15} more seed rows in the table.` : ""}

Key Action Buttons in this Stage:
- "Check this seed": Probes initial search volume and raw keyword count for a single term in the selected market.
- "Check demand": Probes search volume for all checked/selected seed rows in bulk.
- "Add a broad seed": Allows merchant to add custom seed terms.
- "Next - Extract": Advances to Stage 4 keyword extraction.`;
  }

  const systemInstruction = `You are the interactive Market Research Agent powered by Gemini 3.7 Flash for the store "${input.storeName}".
You assist the merchant live throughout the market research workflow.

CURRENT USER CONTEXT & ACTIVE STAGE:
- Current Active Stage: ${stageName}
- Stage Objective: ${stageGoal}

${screenContext}

CRITICAL RULES:
1. ALWAYS accurately recognize the active stage (${stageName}). If the user asks in Arabic (e.g. "في أي مرحلة نحن الآن؟" or "أين نحن؟") or in English (e.g. "What stage is this?"), clearly state that we are in ${stageName} and explain what is displayed on the screen.
2. ALWAYS reply in the same language as the user (Arabic if the user writes in Arabic, English if in English).
3. If the user asks about any button or column on the screen (e.g. "Check this seed", "Check demand", "Scope", "Canonical", "Variation type", checkboxes, etc.), explain its exact function in the context of the current stage.
4. Keep answers clear, friendly, concise, and helpful.
5. In Stage 1 only: If the merchant asks to adjust, combine, add, or remove parent niches, set "nichesUpdated": true and output the updated niches JSON. In Stage 2 and 3, keep "nichesUpdated": false.

Output strictly valid JSON with this schema:
{
  "reply": "Your conversational response to the merchant",
  "nichesUpdated": false,
  "updatedNiches": [
    {
      "id": "slug",
      "name": "Niche Name",
      "summary": "One sentence summary",
      "collectionIds": ["col_id_1", "col_id_2"]
    }
  ]
}`;

  const conversationContext = input.messages
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const userPrompt = `Conversation History:\n${conversationContext || "(none)"}\n\nUSER: ${input.userMessage}\n\nProvide your response and JSON schema.`;

  try {
    const result = await runGeminiMarketResearch<GeminiChatResponse>({
      stage: Math.min(Math.max(currentStage, 1), 7),
      systemInstruction,
      userPrompt,
      overrideThinking: "low",
    });

    const parsed = result.data;
    if (parsed) {
      const reply = parsed.reply || "I have analyzed your request.";

      if (
        currentStage === 1 &&
        parsed.nichesUpdated &&
        Array.isArray(parsed.updatedNiches) &&
        parsed.updatedNiches.length > 0
      ) {
        const collectionsMap = new Map<string, StoreCollectionItem>(
          input.collections.map((c) => [c.id, c])
        );

        const structuredNiches: MockNiche[] = parsed.updatedNiches.map((n, idx) => {
          const nicheId = n.id ? slugify(n.id) : slugify(n.name || `niche-${idx + 1}`);
          const nicheCollections: MockCollection[] = (n.collectionIds || [])
            .map((cid) => {
              const found = collectionsMap.get(cid);
              if (!found) return null;
              return {
                id: found.id,
                name: found.name,
                productCount: found.productCount,
                description: found.description || undefined,
                plpPath: found.plpPath || undefined,
              };
            })
            .filter(Boolean) as MockCollection[];

          const productCount = nicheCollections.reduce(
            (sum, c) => sum + c.productCount,
            0
          );

          return {
            id: nicheId,
            name: n.name,
            productCount,
            collections: nicheCollections,
          };
        });

        const nichesReadings: NicheReading[] = structuredNiches.map((sn, idx) => {
          const matchingParsed = parsed.updatedNiches![idx];
          return {
            id: sn.id,
            name: sn.name,
            summary:
              matchingParsed?.summary ||
              `Covers ${sn.collections.length} collections with ${sn.productCount} items.`,
          };
        });

        return {
          reply,
          updatedNiches: nichesReadings,
          updatedStructuredNiches: structuredNiches,
        };
      }

      return { reply };
    }
  } catch (error) {
    console.error("[runStage1AgentChat] Gemini 3.7 Flash chat call failed:", error);
  }

  return {
    reply: `I understand your question about Stage ${currentStage}. I am ready to assist you with the collections and data on your screen.`,
  };
}

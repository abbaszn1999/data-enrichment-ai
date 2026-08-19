import type {
  CollectionContent,
  CollectionFaq,
  CollectionLink,
  OnPageInstructions,
  ProposedCollection,
} from "@/components/market-research/workspace-data";
import { normalizeOnPageInstructions } from "@/components/market-research/workspace-data";
import type { StoreCollectionItem } from "./store-catalog";
import { runGeminiMarketResearch } from "./gemini-runner";

export interface Stage6OnPageInput {
  storeName?: string;
  parentNiches?: string[];
  collections: ProposedCollection[];
  allStoreCollections?: StoreCollectionItem[];
  customInstructions?: Partial<OnPageInstructions>;
}

export interface Stage6OnPageResult {
  contentById: Record<string, CollectionContent>;
  isAiGenerated: boolean;
}

interface GeminiCollectionContentItem {
  collectionId: string;
  seoTitle: string;
  seoDescription: string;
  collectionDescription: string;
  faqs: Array<{ q: string; a: string }>;
  links?: Array<{ label: string; href: string }>;
}

interface GeminiOnPageResponse {
  contents: GeminiCollectionContentItem[];
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "all", "our", "you", "your", "are", "from",
  "that", "this", "these", "those", "have", "has", "more", "best", "top",
  "shop", "store", "buy", "online", "get", "new", "collections", "collection",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function calculateCosineSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const freqA = new Map<string, number>();
  for (const t of tokensA) freqA.set(t, (freqA.get(t) ?? 0) + 1);

  const freqB = new Map<string, number>();
  for (const t of tokensB) freqB.set(t, (freqB.get(t) ?? 0) + 1);

  let magASq = 0;
  for (const f of freqA.values()) magASq += f * f;
  const magA = Math.sqrt(magASq);

  let magBSq = 0;
  for (const f of freqB.values()) magBSq += f * f;
  const magB = Math.sqrt(magBSq);

  if (magA === 0 || magB === 0) return 0;

  let dot = 0;
  for (const [token, fA] of freqA) {
    const fB = freqB.get(token);
    if (fB) dot += fA * fB;
  }

  return dot / (magA * magB);
}

/**
 * Computes cosine similarity recommendations between a source collection and
 * all candidate collections (both newly proposed and existing store collections).
 */
export function computeInternalLinks(
  sourceCol: ProposedCollection,
  allCandidates: Array<{
    id: string;
    name: string;
    handle: string;
    headKeyword?: string;
    parentNiche?: string;
    description?: string;
    plpPath?: string;
  }>,
  linksPerPage = 4,
  minSimilarity = 0.05
): CollectionLink[] {
  const sourceText = `${sourceCol.name} ${sourceCol.headKeyword} ${sourceCol.parentNiche || ""}`;
  const scored: Array<{ label: string; href: string; score: number }> = [];

  for (const cand of allCandidates) {
    // Avoid self-link
    if (
      cand.id === sourceCol.id ||
      cand.name.toLowerCase() === sourceCol.name.toLowerCase()
    ) {
      continue;
    }

    const candText = `${cand.name} ${cand.headKeyword || ""} ${cand.parentNiche || ""} ${cand.description || ""}`;
    const score = calculateCosineSimilarity(sourceText, candText);

    if (score >= minSimilarity) {
      const href = cand.plpPath
        ? cand.plpPath
        : `/collections/${cand.handle || cand.id.replace(/^col-/, "")}`;

      scored.push({
        label: cand.name,
        href,
        score,
      });
    }
  }

  // Sort descending by score and pick top K
  scored.sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return scored.slice(0, linksPerPage).map(({ label, href }) => ({
      label,
      href,
    }));
  }

  // Fallback if no candidate meets threshold
  const slug = sourceCol.id.replace(/^col-/, "");
  return [
    { label: sourceCol.parentNiche || "All Collections", href: "/collections" },
    { label: "Buying Guide & Reviews", href: `/pages/${slug}-guide` },
  ];
}

/**
 * Heuristic fallback on-page writer if AI is unavailable.
 */
export function runHeuristicStage6OnPage(
  input: Stage6OnPageInput
): Stage6OnPageResult {
  const instructions = normalizeOnPageInstructions(input.customInstructions);
  const clip = (val: string) =>
    val.trim() ? ` (Follows custom instruction: “${val.trim().slice(0, 80)}”)` : "";

  const allCandidates = [
    ...input.collections.map((c) => ({
      id: c.id,
      name: c.name,
      handle: c.id.replace(/^col-/, ""),
      headKeyword: c.headKeyword,
      parentNiche: c.parentNiche,
    })),
    ...(input.allStoreCollections || []).map((s) => ({
      id: s.id,
      name: s.name,
      handle: s.handle,
      description: s.description,
      plpPath: s.plpPath,
    })),
  ];

  const contentById: Record<string, CollectionContent> = {};

  for (const col of input.collections) {
    const name = col.name;
    const store = input.storeName || "Store";
    const head = col.headKeyword;

    const seoTitle = instructions.seoTitle.trim()
      ? `${name} | Shop ${head} - ${store}${clip(instructions.seoTitle)}`
      : `${name} | Shop ${head} - ${store}`;

    const seoDescription = instructions.seoDescription.trim()
      ? `Browse ${col.productCount || 1} ${name.toLowerCase()}. Find the best ${head} with top quality, great prices, and fast shipping.${clip(instructions.seoDescription)}`
      : `Browse ${col.productCount || 1} ${name.toLowerCase()}. Find the best ${head} with top quality, great prices, and fast shipping.`;

    const collectionDescription = instructions.collectionDescription.trim()
      ? `Explore our curated selection of ${name.toLowerCase()}. Designed for shoppers looking for premium ${head}, this collection brings together verified options for every budget and style.${clip(instructions.collectionDescription)}`
      : `Explore our curated selection of ${name.toLowerCase()}. Designed for shoppers looking for premium ${head}, this collection brings together verified options for every budget and style.`;

    const faqs: CollectionFaq[] = [
      {
        q: `What should I consider when buying ${name.toLowerCase()}?`,
        a: instructions.faq.trim()
          ? `Focus on quality, compatibility, and key features that match your needs. Our ${name.toLowerCase()} collection provides tested choices.${clip(instructions.faq)}`
          : `Focus on quality, compatibility, and key features that match your needs. Our ${name.toLowerCase()} collection provides tested choices.`,
      },
      {
        q: `Are these ${head} suitable for daily use?`,
        a: `Yes, all items featured in our ${name} collection are selected for reliable performance, durability, and customer satisfaction.`,
      },
      {
        q: `How fast is shipping for ${name.toLowerCase()}?`,
        a: `Orders are processed promptly with reliable tracking and express delivery options available at checkout.`,
      },
    ];

    const links = computeInternalLinks(col, allCandidates, 3);

    contentById[col.id] = {
      collectionId: col.id,
      seoTitle,
      seoDescription,
      collectionDescription,
      faqs,
      links,
    };
  }

  return {
    contentById,
    isAiGenerated: false,
  };
}

/**
 * Generates on-page content for a single batch of collections (up to 10).
 */
async function generateBatchStage6(
  input: Stage6OnPageInput,
  batchCollections: ProposedCollection[],
  allCandidates: Array<{
    id: string;
    name: string;
    handle: string;
    headKeyword?: string;
    parentNiche?: string;
    description?: string;
    plpPath?: string;
  }>
): Promise<Record<string, CollectionContent>> {
  const instructions = normalizeOnPageInstructions(input.customInstructions);

  const customInstructionsContext = {
    seoTitle: instructions.seoTitle.trim() || undefined,
    seoDescription: instructions.seoDescription.trim() || undefined,
    collectionDescription: instructions.collectionDescription.trim() || undefined,
    faq: instructions.faq.trim() || undefined,
  };

  const userPrompt = JSON.stringify({
    storeName: input.storeName || "Ecommerce Store",
    parentNiches: input.parentNiches || [],
    customInstructions: customInstructionsContext,
    collectionsToGenerate: batchCollections.map((c) => ({
      collectionId: c.id,
      name: c.name,
      headKeyword: c.headKeyword,
      parentNiche: c.parentNiche,
      volume: c.volume,
      difficulty: c.difficulty,
      productCount: c.productCount,
      keywordCount: c.keywordCount,
      status: c.status,
      existingName: c.existingName,
    })),
  });

  const systemInstruction = `You are the Autommerce On-Page Copywriting Agent powered by Gemini 3.7 Flash.
Your task is Stage 6 of Market Research:
Generate compelling, high-converting, and SEO-optimized collection page copy for each collection provided.

### Specific Instructions For The 4 Customizable Fields:
1. "seoTitle":
   ${instructions.seoTitle.trim() ? `CRITICAL USER INSTRUCTION FOR SEO TITLE: "${instructions.seoTitle.trim()}". Follow this strictly.` : "Write a concise, high-CTR title tag containing the head keyword and collection name (~50-60 characters)."}
2. "seoDescription":
   ${instructions.seoDescription.trim() ? `CRITICAL USER INSTRUCTION FOR META DESCRIPTION: "${instructions.seoDescription.trim()}". Follow this strictly.` : "Write a compelling meta description (~140-160 characters) with a clear value proposition and call to action."}
3. "collectionDescription":
   ${instructions.collectionDescription.trim() ? `CRITICAL USER INSTRUCTION FOR COLLECTION DESCRIPTION: "${instructions.collectionDescription.trim()}". Follow this strictly.` : "Write 1-2 engaging, natural paragraphs (80-140 words) describing the collection, its benefits, and shopper use cases."}
4. "faqs":
   ${instructions.faq.trim() ? `CRITICAL USER INSTRUCTION FOR FAQS: "${instructions.faq.trim()}". Follow this strictly.` : "Write 3-4 structured, informative FAQ questions and helpful answers that shoppers genuinely ask before buying."}

Output strictly valid JSON with this exact schema:
{
  "contents": [
    {
      "collectionId": "col-id-matching-input",
      "seoTitle": "Collection Title | Shop Head Keyword",
      "seoDescription": "Meta description...",
      "collectionDescription": "Collection description...",
      "faqs": [
        {
          "q": "Question here?",
          "a": "Answer here."
        }
      ]
    }
  ]
}`;

  const result = await runGeminiMarketResearch<GeminiOnPageResponse>({
    stage: 6,
    systemInstruction,
    userPrompt,
  });

  const parsed = result.data;
  const batchContent: Record<string, CollectionContent> = {};

  if (parsed && Array.isArray(parsed.contents)) {
    for (const item of parsed.contents) {
      if (!item.collectionId) continue;
      const sourceCol = batchCollections.find((c) => c.id === item.collectionId);
      const computedLinks = sourceCol
        ? computeInternalLinks(sourceCol, allCandidates, 4)
        : [];

      batchContent[item.collectionId] = {
        collectionId: item.collectionId,
        seoTitle: item.seoTitle || `${item.collectionId} | Shop Now`,
        seoDescription: item.seoDescription || "",
        collectionDescription: item.collectionDescription || "",
        faqs: Array.isArray(item.faqs) ? item.faqs : [],
        links: computedLinks,
      };
    }
  }

  // Fallback for any collection missing in the AI response
  for (const col of batchCollections) {
    if (!batchContent[col.id]) {
      const fallback = runHeuristicStage6OnPage({
        ...input,
        collections: [col],
      });
      if (fallback.contentById[col.id]) {
        batchContent[col.id] = fallback.contentById[col.id];
      }
    }
  }

  return batchContent;
}

/**
 * Main Stage 6 On-Page generator.
 * Processes collections in chunks of 10 for fast, reliable generation.
 */
export async function runStage6OnPageGeneration(
  input: Stage6OnPageInput,
  chunkSize = 10
): Promise<Stage6OnPageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || input.collections.length === 0) {
    return runHeuristicStage6OnPage(input);
  }

  const allCandidates = [
    ...input.collections.map((c) => ({
      id: c.id,
      name: c.name,
      handle: c.id.replace(/^col-/, ""),
      headKeyword: c.headKeyword,
      parentNiche: c.parentNiche,
    })),
    ...(input.allStoreCollections || []).map((s) => ({
      id: s.id,
      name: s.name,
      handle: s.handle,
      description: s.description,
      plpPath: s.plpPath,
    })),
  ];

  // Split collections into chunks of up to 10
  const chunks: ProposedCollection[][] = [];
  for (let i = 0; i < input.collections.length; i += chunkSize) {
    chunks.push(input.collections.slice(i, i + chunkSize));
  }

  const finalContentById: Record<string, CollectionContent> = {};
  let anyAiGenerated = false;

  for (const chunk of chunks) {
    try {
      const batchResult = await generateBatchStage6(input, chunk, allCandidates);
      Object.assign(finalContentById, batchResult);
      anyAiGenerated = true;
    } catch (err) {
      console.error("[runStage6OnPageGeneration] Batch error, falling back to heuristic for chunk:", err);
      const fallback = runHeuristicStage6OnPage({
        ...input,
        collections: chunk,
      });
      Object.assign(finalContentById, fallback.contentById);
    }
  }

  return {
    contentById: finalContentById,
    isAiGenerated: anyAiGenerated,
  };
}

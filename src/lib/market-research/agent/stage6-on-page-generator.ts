import type {
  CollectionContent,
  CollectionFaq,
  CollectionLink,
  OnPageInstructions,
  ProposedCollection,
} from "@/components/market-research/workspace-data";
import { normalizeOnPageInstructions } from "@/components/market-research/workspace-data";
import { runGeminiMarketResearch } from "./gemini-runner";

export interface Stage6OnPageInput {
  storeName?: string;
  parentNiches?: string[];
  collections: ProposedCollection[];
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

/**
 * Heuristic fallback on-page writer if AI is unavailable.
 */
export function runHeuristicStage6OnPage(
  input: Stage6OnPageInput
): Stage6OnPageResult {
  const instructions = normalizeOnPageInstructions(input.customInstructions);
  const clip = (val: string) =>
    val.trim() ? ` (Follows custom instruction: “${val.trim().slice(0, 80)}”)` : "";

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

    const slug = col.id.replace(/^col-/, "");
    const links: CollectionLink[] = [
      {
        label: col.existingName ?? col.parentNiche ?? "All Collections",
        href: `/collections/${slug}`,
      },
      {
        label: "Buying Guide & Reviews",
        href: `/pages/${slug}-guide`,
      },
      {
        label: "Related Categories",
        href: "/collections",
      },
    ];

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

export async function runStage6OnPageGeneration(
  input: Stage6OnPageInput
): Promise<Stage6OnPageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || input.collections.length === 0) {
    return runHeuristicStage6OnPage(input);
  }

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
    collectionsToGenerate: input.collections.map((c) => ({
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

5. "links":
   Provide 2-3 helpful internal links with descriptive label and standard ecommerce href.

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
      ],
      "links": [
        {
          "label": "Related link title",
          "href": "/collections/slug"
        }
      ]
    }
  ]
}`;

  try {
    const result = await runGeminiMarketResearch<GeminiOnPageResponse>({
      stage: 6,
      systemInstruction,
      userPrompt,
    });

    const parsed = result.data;
    if (!parsed || !Array.isArray(parsed.contents) || parsed.contents.length === 0) {
      return runHeuristicStage6OnPage(input);
    }

    const contentById: Record<string, CollectionContent> = {};

    for (const item of parsed.contents) {
      if (!item.collectionId) continue;
      contentById[item.collectionId] = {
        collectionId: item.collectionId,
        seoTitle: item.seoTitle || `${item.collectionId} | Shop Now`,
        seoDescription: item.seoDescription || "",
        collectionDescription: item.collectionDescription || "",
        faqs: Array.isArray(item.faqs) ? item.faqs : [],
        links: Array.isArray(item.links) && item.links.length > 0
          ? item.links
          : [
              { label: "Buying Guide", href: "/pages/guide" },
              { label: "All Collections", href: "/collections" },
            ],
      };
    }

    // Check if all requested collections were generated; fallback if any missing
    for (const col of input.collections) {
      if (!contentById[col.id]) {
        const fallback = runHeuristicStage6OnPage({ ...input, collections: [col] });
        if (fallback.contentById[col.id]) {
          contentById[col.id] = fallback.contentById[col.id];
        }
      }
    }

    return {
      contentById,
      isAiGenerated: true,
    };
  } catch (err) {
    console.error("[runStage6OnPageGeneration] Gemini error, fallback to heuristic:", err);
    return runHeuristicStage6OnPage(input);
  }
}

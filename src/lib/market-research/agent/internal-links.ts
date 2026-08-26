import type {
  ArticleLinkTarget,
  CollectionLink,
  ProposedCollection,
} from "@/components/market-research/workspace-data";
import type { StoreCollectionItem } from "./store-catalog";
import { cosineSimilarity, embedTexts } from "./embeddings";
import { runGeminiMarketResearch } from "./gemini-runner";

/**
 * Internal linking engine.
 *
 * The objective is deliberately *not* "most similar page". Maximum similarity
 * always resolves to a near-duplicate, which is the worst possible outcome for
 * both SEO (keyword cannibalisation) and shoppers (the same grid again). What
 * carries value is the taxonomy relationship — broader, sibling, narrower,
 * complementary — so relevance is only one term in the ranking.
 *
 * Pipeline:
 *   1. Registry  — every linkable node with a *verified* href. URLs are looked
 *                  up, never minted, so a link can't 404.
 *   2. Retrieval — hybrid dense (embeddings) + sparse (tf-idf) shortlist.
 *   3. Typing    — deterministic relationship classification and duplicate
 *                  suppression from token-set containment.
 *   4. Judgement — Gemini picks from the shortlist by index and writes anchors.
 *                  It never emits a URL, so it cannot hallucinate one.
 *   5. Graph     — in-degree balancing and orphan adoption across the store.
 */

export type LinkRelation =
  | "parent"
  | "sibling"
  | "child"
  | "complement"
  | "duplicate"
  | "unrelated";

const RELATION_VALUE: Record<LinkRelation, number> = {
  parent: 1,
  sibling: 0.92,
  child: 0.75,
  complement: 0.55,
  duplicate: 0,
  unrelated: 0,
};

/** Preferred composition of a link block, in fill order. */
const RELATION_QUOTA: Array<{ relation: LinkRelation; max: number }> = [
  { relation: "parent", max: 1 },
  { relation: "sibling", max: 2 },
  { relation: "child", max: 1 },
  { relation: "complement", max: 2 },
];

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "all", "our", "you", "your", "are", "from",
  "that", "this", "these", "those", "have", "has", "more", "best", "top",
  "shop", "store", "buy", "online", "get", "new", "collection", "collections",
  "category", "categories", "products", "product", "sale", "deals",
]);

/** Above this dense similarity two pages are the same page for linking purposes. */
const NEAR_DUPLICATE_THRESHOLD = 0.97;
const MIN_RELEVANCE = 0.08;
const SHORTLIST_SIZE = 10;
const RETRIEVAL_SIZE = 40;
const SOURCES_PER_AI_CALL = 10;
const MAX_EMBEDDED_NODES = 2000;

export interface InternalLinkInput {
  proposed: ProposedCollection[];
  storeCollections?: StoreCollectionItem[];
  /** Prefix the push step prepends to store titles, e.g. "AI". */
  collectionPrefix?: string;
  provider?: string;
  linksPerPage?: number;
  /** Disables the Gemini re-ranking pass (deterministic ordering only). */
  disableAi?: boolean;
}

export type InternalLinkGraph = Record<string, CollectionLink[]>;

type LinkNode = {
  key: string;
  /** Prefix-stripped display title used for anchors. */
  title: string;
  normalized: string;
  tokens: string[];
  tokenSet: Set<string>;
  href: string;
  resolved: boolean;
  published: boolean;
  productCount: number;
  volume: number;
  embedText: string;
  vector?: number[] | null;
};

type Candidate = {
  node: LinkNode;
  relation: LinkRelation;
  relevance: number;
  score: number;
};

// ─── text utilities ───────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes the store naming prefix so a proposed collection and the collection
 * it was pushed as ("Apple Chargers" vs "AI - Apple Chargers") collapse onto a
 * single node instead of looking like a perfect link target for each other.
 */
export function stripCollectionPrefix(title: string, prefix?: string): string {
  const clean = (title || "").trim();
  const p = (prefix || "").trim();
  if (!p) return clean;
  return clean
    .replace(new RegExp(`^${escapeRegex(p)}\\s*[-–—:|]\\s*`, "i"), "")
    .replace(new RegExp(`^${escapeRegex(p)}\\s+`, "i"), "")
    .trim();
}

function normalizeTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(text: string): string {
  return (
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "collection"
  );
}

// ─── relationship typing ──────────────────────────────────────────────────────

/**
 * Classifies the candidate relative to the source using token-set containment.
 * Containment is what encodes hierarchy: "apple chargers" ⊂ "apple ipad
 * chargers" means the former is the broader parent page.
 */
export function classifyRelation(
  sourceTokens: Set<string>,
  candidateTokens: Set<string>
): LinkRelation {
  if (sourceTokens.size === 0 || candidateTokens.size === 0) return "unrelated";

  let shared = 0;
  for (const token of candidateTokens) {
    if (sourceTokens.has(token)) shared += 1;
  }
  if (shared === 0) return "unrelated";

  const candidateInSource = shared === candidateTokens.size;
  const sourceInCandidate = shared === sourceTokens.size;

  if (candidateInSource && sourceInCandidate) return "duplicate";
  if (candidateInSource) return "parent";
  if (sourceInCandidate) return "child";

  const union = sourceTokens.size + candidateTokens.size - shared;
  const jaccard = union > 0 ? shared / union : 0;
  if (sourceTokens.size === candidateTokens.size && candidateTokens.size - shared === 1) {
    return "sibling";
  }
  if (jaccard >= 0.5) return "sibling";

  return "complement";
}

// ─── sparse scoring ───────────────────────────────────────────────────────────

/**
 * Inverse document frequency over the store's own titles. Without it every
 * token weighs the same, so in a catalogue of chargers the word "chargers"
 * drowns out the tokens that actually discriminate ("ipad", "storage").
 */
function buildIdf(nodes: LinkNode[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const node of nodes) {
    for (const token of new Set(node.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const total = Math.max(1, nodes.length);
  const idf = new Map<string, number>();
  for (const [token, freq] of documentFrequency) {
    idf.set(token, Math.log((total + 1) / (freq + 0.5)));
  }
  return idf;
}

function tfIdfVector(
  tokens: string[],
  idf: Map<string, number>
): Map<string, number> {
  const termFrequency = new Map<string, number>();
  for (const token of tokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  const vector = new Map<string, number>();
  for (const [token, tf] of termFrequency) {
    const weight = tf * (idf.get(token) ?? Math.log(2));
    if (weight > 0) vector.set(token, weight);
  }
  return vector;
}

function sparseCosine(
  a: Map<string, number>,
  b: Map<string, number>
): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [token, weight] of small) {
    const other = large.get(token);
    if (other) dot += weight * other;
  }
  if (dot === 0) return 0;

  let magA = 0;
  for (const weight of a.values()) magA += weight * weight;
  let magB = 0;
  for (const weight of b.values()) magB += weight * weight;
  if (magA === 0 || magB === 0) return 0;

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── registry ─────────────────────────────────────────────────────────────────

function safeFallbackLinks(provider?: string): CollectionLink[] {
  const isWoo = provider === "woocommerce" || provider === "wordpress";
  if (isWoo) {
    return [{ label: "Browse all products", href: "/shop" }];
  }
  return [
    { label: "Browse all collections", href: "/collections" },
    { label: "Shop all products", href: "/collections/all" },
  ];
}

/**
 * Builds the link registry and the mapping from each proposed collection to its
 * node. A proposed collection that already exists in the store shares that
 * store node, which is where duplicate link targets get eliminated.
 */
function buildRegistry(input: InternalLinkInput): {
  nodes: LinkNode[];
  sourceNodeByProposedId: Map<string, LinkNode>;
} {
  const prefix = input.collectionPrefix;
  const nodes: LinkNode[] = [];
  const nodeByNormalized = new Map<string, LinkNode>();

  const makeNode = (params: {
    key: string;
    rawTitle: string;
    href: string;
    resolved: boolean;
    published: boolean;
    productCount: number;
    volume?: number;
    extraText?: string;
  }): LinkNode => {
    const title = stripCollectionPrefix(params.rawTitle, prefix) || params.rawTitle;
    const normalized = normalizeTitle(title);
    const tokens = tokenize(title);
    return {
      key: params.key,
      title,
      normalized,
      tokens,
      tokenSet: new Set(tokens),
      href: params.href,
      resolved: params.resolved,
      published: params.published,
      productCount: params.productCount,
      volume: params.volume ?? 0,
      embedText: [title, params.extraText].filter(Boolean).join(". ").slice(0, 800),
    };
  };

  for (const store of input.storeCollections ?? []) {
    const href = store.plpPath || (store.handle ? `/collections/${store.handle}` : "");
    if (!href) continue;

    const node = makeNode({
      key: `store:${store.id || store.handle}`,
      rawTitle: store.name || store.handle,
      href,
      resolved: true,
      published: store.published !== false,
      productCount: store.productCount ?? 0,
      extraText: store.description,
    });
    if (!node.normalized) continue;

    const existing = nodeByNormalized.get(node.normalized);
    if (existing) {
      // Same page under two titles — keep the one with real inventory.
      if (node.productCount > existing.productCount) {
        existing.href = node.href;
        existing.productCount = node.productCount;
        existing.published = node.published;
      }
      continue;
    }
    nodeByNormalized.set(node.normalized, node);
    nodes.push(node);
  }

  const sourceNodeByProposedId = new Map<string, LinkNode>();

  for (const collection of input.proposed) {
    const cleanName = stripCollectionPrefix(collection.name, prefix);
    const normalized = normalizeTitle(cleanName);
    const existing = normalized ? nodeByNormalized.get(normalized) : undefined;

    if (existing) {
      // Already live in the store: reuse the verified node and enrich it with
      // the demand data we know from the research pipeline.
      existing.volume = Math.max(existing.volume, collection.volume || 0);
      if (collection.headKeyword && !existing.embedText.includes(collection.headKeyword)) {
        existing.embedText = `${existing.embedText}. ${collection.headKeyword}`.slice(0, 800);
      }
      sourceNodeByProposedId.set(collection.id, existing);
      continue;
    }

    // A handle only exists once the collection has been pushed. Until then its
    // storefront URL is a guess, so the node is registered as unresolved and is
    // excluded as a link target rather than risking a 404.
    const pushedHandle = collection.storeHandle?.trim();
    const predictedHandle =
      pushedHandle ||
      slugify(
        input.collectionPrefix
          ? `${input.collectionPrefix} ${cleanName || collection.name}`
          : cleanName || collection.name
      );
    const node = makeNode({
      key: `proposed:${collection.id}`,
      rawTitle: cleanName || collection.name,
      href: `/collections/${predictedHandle}`,
      resolved: Boolean(pushedHandle),
      published: Boolean(pushedHandle),
      productCount: collection.productCount ?? 0,
      volume: collection.volume ?? 0,
      extraText: [collection.headKeyword, collection.parentNiche]
        .filter(Boolean)
        .join(". "),
    });
    if (normalized) nodeByNormalized.set(normalized, node);
    nodes.push(node);
    sourceNodeByProposedId.set(collection.id, node);
  }

  return { nodes, sourceNodeByProposedId };
}

// ─── retrieval and ranking ────────────────────────────────────────────────────

function normalizeLog(value: number, ceiling: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log(1 + value) / Math.log(1 + ceiling));
}

function retrieveCandidates(
  source: LinkNode,
  nodes: LinkNode[],
  idf: Map<string, number>,
  sparseVectors: Map<string, Map<string, number>>,
  useDense: boolean
): Candidate[] {
  const sourceSparse = sparseVectors.get(source.key) ?? tfIdfVector(source.tokens, idf);
  const maxProducts = Math.max(
    10,
    ...nodes.map((node) => node.productCount || 0)
  );
  const maxVolume = Math.max(10, ...nodes.map((node) => node.volume || 0));

  const candidates: Candidate[] = [];

  for (const node of nodes) {
    if (node.key === source.key) continue;
    // Only verified, live, non-empty pages are linkable.
    if (!node.resolved || !node.published) continue;
    if (node.productCount <= 0) continue;

    const dense =
      useDense && source.vector && node.vector
        ? cosineSimilarity(source.vector, node.vector)
        : null;

    // A near-identical vector means the same page wearing a different title.
    if (dense !== null && dense >= NEAR_DUPLICATE_THRESHOLD) continue;

    const relation = classifyRelation(source.tokenSet, node.tokenSet);
    if (relation === "duplicate" || relation === "unrelated") continue;

    const sparse = sparseCosine(
      sourceSparse,
      sparseVectors.get(node.key) ?? tfIdfVector(node.tokens, idf)
    );
    const relevance = dense !== null ? 0.65 * dense + 0.35 * sparse : sparse;
    if (relevance < MIN_RELEVANCE) continue;

    const business =
      0.5 * normalizeLog(node.productCount, maxProducts) +
      0.5 * normalizeLog(node.volume, maxVolume);

    const score =
      0.55 * relevance + 0.3 * RELATION_VALUE[relation] + 0.15 * business;

    candidates.push({ node, relation, relevance, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, RETRIEVAL_SIZE);
}

// ─── Gemini judgement pass ────────────────────────────────────────────────────

type AiSelection = { index: number; anchor?: string };

interface AiSelectionResponse {
  selections?: Array<{
    collectionId?: string;
    links?: AiSelection[];
  }>;
}

/**
 * Asks Gemini to choose from the shortlist. It answers with indices only — the
 * caller resolves those to verified hrefs — which makes a fabricated URL
 * structurally impossible.
 */
async function selectWithAi(
  batch: Array<{
    collectionId: string;
    source: LinkNode;
    shortlist: Candidate[];
  }>,
  linksPerPage: number
): Promise<Map<string, AiSelection[]>> {
  const picks = new Map<string, AiSelection[]>();
  if (batch.length === 0) return picks;

  const userPrompt = JSON.stringify({
    task: "select_internal_links",
    linksPerPage,
    pages: batch.map((item) => ({
      collectionId: item.collectionId,
      currentPage: item.source.title,
      candidates: item.shortlist.map((candidate, index) => ({
        index,
        title: candidate.node.title,
        relation: candidate.relation,
        productCount: candidate.node.productCount,
      })),
    })),
  });

  const systemInstruction = `You are the Autommerce Internal Linking Judge.

For each page you receive a numbered candidate list. Choose up to ${linksPerPage} candidates that genuinely help a shopper move forward, and write the anchor text for each.

Selection rules:
- Prefer a mix: one broader ("parent") page, one or two "sibling" pages, and a "complement" or "child" page. Never fill the block with one relation type.
- Reject any candidate that is effectively the same page as the current page.
- Reject candidates a shopper would find pointless from the current page.
- Anchor text must be natural, under 60 characters, and must not repeat the current page title verbatim. Vary anchors so several links never share the same wording.

Hard constraints:
- You MUST only reference candidates by their given "index".
- You MUST NOT write, invent, or guess any URL, path, slug, or handle.
- If fewer than ${linksPerPage} candidates are worth linking, return fewer.

Output strictly valid JSON:
{
  "selections": [
    {
      "collectionId": "id from input",
      "links": [ { "index": 0, "anchor": "Anchor text" } ]
    }
  ]
}`;

  try {
    const result = await runGeminiMarketResearch<AiSelectionResponse>({
      stage: 6,
      systemInstruction,
      userPrompt,
    });

    for (const selection of result.data?.selections ?? []) {
      if (!selection.collectionId || !Array.isArray(selection.links)) continue;
      const entry = batch.find((b) => b.collectionId === selection.collectionId);
      if (!entry) continue;

      const valid: AiSelection[] = [];
      const usedIndices = new Set<number>();
      for (const link of selection.links) {
        const index = Number(link?.index);
        if (!Number.isInteger(index)) continue;
        if (index < 0 || index >= entry.shortlist.length) continue;
        if (usedIndices.has(index)) continue;
        usedIndices.add(index);
        valid.push({ index, anchor: link?.anchor });
      }
      if (valid.length > 0) picks.set(selection.collectionId, valid);
    }
  } catch (error) {
    console.error("[internal-links] AI selection failed, using deterministic ranking:", error);
  }

  return picks;
}

// ─── graph assembly ───────────────────────────────────────────────────────────

function sanitizeAnchor(
  anchor: string | undefined,
  node: LinkNode,
  usedAnchors: Set<string>
): string {
  const cleaned = (anchor || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const candidate = cleaned || node.title;
  const key = candidate.toLowerCase();
  if (!usedAnchors.has(key)) {
    usedAnchors.add(key);
    return candidate;
  }
  // Anchor already used on this page — fall back to the plain title.
  const fallbackKey = node.title.toLowerCase();
  if (!usedAnchors.has(fallbackKey)) {
    usedAnchors.add(fallbackKey);
    return node.title;
  }
  return candidate;
}

/**
 * Picks the final block for one page: honour the AI ordering first, then top up
 * against the relation quota, then by raw score. In-degree caps keep a handful
 * of pages from absorbing every link in the store.
 */
function assemblePageLinks(params: {
  candidates: Candidate[];
  aiPicks: AiSelection[] | undefined;
  shortlist: Candidate[];
  linksPerPage: number;
  inDegree: Map<string, number>;
  inDegreeCap: number;
}): Array<{ candidate: Candidate; anchor?: string }> {
  const { candidates, aiPicks, shortlist, linksPerPage, inDegree, inDegreeCap } =
    params;

  const chosen: Array<{ candidate: Candidate; anchor?: string }> = [];
  const chosenKeys = new Set<string>();

  const tryAdd = (
    candidate: Candidate,
    anchor: string | undefined,
    respectCap: boolean
  ): boolean => {
    if (chosen.length >= linksPerPage) return false;
    if (chosenKeys.has(candidate.node.key)) return false;
    if (respectCap && (inDegree.get(candidate.node.key) ?? 0) >= inDegreeCap) {
      return false;
    }
    chosen.push({ candidate, anchor });
    chosenKeys.add(candidate.node.key);
    return true;
  };

  for (const pick of aiPicks ?? []) {
    const candidate = shortlist[pick.index];
    if (candidate) tryAdd(candidate, pick.anchor, true);
  }

  for (const quota of RELATION_QUOTA) {
    if (chosen.length >= linksPerPage) break;
    let taken = chosen.filter((c) => c.candidate.relation === quota.relation).length;
    for (const candidate of candidates) {
      if (taken >= quota.max || chosen.length >= linksPerPage) break;
      if (candidate.relation !== quota.relation) continue;
      if (tryAdd(candidate, undefined, true)) taken += 1;
    }
  }

  for (const candidate of candidates) {
    if (chosen.length >= linksPerPage) break;
    tryAdd(candidate, undefined, true);
  }

  // Last resort: allow the cap to be exceeded rather than ship an empty block.
  for (const candidate of candidates) {
    if (chosen.length >= Math.min(2, linksPerPage)) break;
    tryAdd(candidate, undefined, false);
  }

  return chosen;
}

/**
 * Builds the internal link graph for every proposed collection.
 */
export async function buildInternalLinkGraph(
  input: InternalLinkInput
): Promise<InternalLinkGraph> {
  const linksPerPage = Math.max(1, input.linksPerPage ?? 4);
  const graph: InternalLinkGraph = {};

  if (input.proposed.length === 0) return graph;

  const { nodes, sourceNodeByProposedId } = buildRegistry(input);

  const linkable = nodes.filter(
    (node) => node.resolved && node.published && node.productCount > 0
  );

  if (linkable.length === 0) {
    const fallback = safeFallbackLinks(input.provider);
    for (const collection of input.proposed) {
      graph[collection.id] = fallback;
    }
    return graph;
  }

  // Dense vectors: one pass for the whole registry, cached by content hash.
  let useDense = false;
  if (nodes.length <= MAX_EMBEDDED_NODES) {
    const vectors = await embedTexts(nodes.map((node) => node.embedText));
    nodes.forEach((node, index) => {
      node.vector = vectors[index];
    });
    useDense = vectors.some((vector) => Array.isArray(vector));
  }

  const idf = buildIdf(nodes);
  const sparseVectors = new Map<string, Map<string, number>>();
  for (const node of nodes) {
    sparseVectors.set(node.key, tfIdfVector(node.tokens, idf));
  }

  const perSource = input.proposed.map((collection) => {
    const source = sourceNodeByProposedId.get(collection.id);
    const candidates = source
      ? retrieveCandidates(source, nodes, idf, sparseVectors, useDense)
      : [];
    return {
      collectionId: collection.id,
      source,
      candidates,
      shortlist: candidates.slice(0, SHORTLIST_SIZE),
    };
  });

  // Judgement pass, batched to keep each prompt small.
  const aiPicksByCollection = new Map<string, AiSelection[]>();
  if (!input.disableAi) {
    const eligible = perSource.filter(
      (item) => item.source && item.shortlist.length > 0
    ) as Array<{
      collectionId: string;
      source: LinkNode;
      candidates: Candidate[];
      shortlist: Candidate[];
    }>;

    for (let i = 0; i < eligible.length; i += SOURCES_PER_AI_CALL) {
      const batch = eligible.slice(i, i + SOURCES_PER_AI_CALL);
      const picks = await selectWithAi(
        batch.map((item) => ({
          collectionId: item.collectionId,
          source: item.source,
          shortlist: item.shortlist,
        })),
        linksPerPage
      );
      for (const [collectionId, selections] of picks) {
        aiPicksByCollection.set(collectionId, selections);
      }
    }
  }

  // Graph pass: balance how much link equity any single page absorbs.
  const inDegree = new Map<string, number>();
  const totalSlots = perSource.length * linksPerPage;
  const inDegreeCap = Math.max(
    2,
    Math.ceil(totalSlots / linksPerPage / Math.max(1, linkable.length)) * 3
  );

  const assembled = new Map<
    string,
    Array<{ candidate: Candidate; anchor?: string }>
  >();

  for (const item of perSource) {
    if (!item.source || item.candidates.length === 0) {
      assembled.set(item.collectionId, []);
      continue;
    }

    const chosen = assemblePageLinks({
      candidates: item.candidates,
      aiPicks: aiPicksByCollection.get(item.collectionId),
      shortlist: item.shortlist,
      linksPerPage,
      inDegree,
      inDegreeCap,
    });

    for (const entry of chosen) {
      inDegree.set(
        entry.candidate.node.key,
        (inDegree.get(entry.candidate.node.key) ?? 0) + 1
      );
    }
    assembled.set(item.collectionId, chosen);
  }

  // Orphan adoption: a live collection with zero inbound links is invisible to
  // crawlers, so give it the best available home even if that page is full.
  for (const node of linkable) {
    if ((inDegree.get(node.key) ?? 0) > 0) continue;

    let bestCollectionId: string | null = null;
    let bestCandidate: Candidate | null = null;
    for (const item of perSource) {
      const match = item.candidates.find((c) => c.node.key === node.key);
      if (!match) continue;
      if (!bestCandidate || match.score > bestCandidate.score) {
        bestCandidate = match;
        bestCollectionId = item.collectionId;
      }
    }

    if (bestCollectionId && bestCandidate) {
      const list = assembled.get(bestCollectionId) ?? [];
      if (!list.some((entry) => entry.candidate.node.key === node.key)) {
        list.push({ candidate: bestCandidate });
        assembled.set(bestCollectionId, list);
        inDegree.set(node.key, 1);
      }
    }
  }

  const fallbackLinks = safeFallbackLinks(input.provider);
  for (const item of perSource) {
    const chosen = assembled.get(item.collectionId) ?? [];
    if (chosen.length === 0) {
      graph[item.collectionId] = fallbackLinks;
      continue;
    }

    const usedAnchors = new Set<string>();
    graph[item.collectionId] = chosen.map((entry) => ({
      label: sanitizeAnchor(entry.anchor, entry.candidate.node, usedAnchors),
      href: entry.candidate.node.href,
    }));
  }

  return graph;
}

// ─── article link targets (Stage 7) ───────────────────────────────────────────

/** Minimum hybrid relevance before a collection is worth linking from an article. */
const ARTICLE_LINK_THRESHOLD = 0.12;

/**
 * Every collection gets at least this many inbound article links before the
 * proportional cap kicks in, so a small plan is not spread uselessly thin.
 */
const MIN_INBOUND_PER_COLLECTION = 5;

/**
 * How far a popular collection may exceed its fair share of inbound links. A
 * broad page like "Cables and Chargers" is the best match for a large slice of
 * the plan, and pretending otherwise would produce worse links — but without a
 * ceiling it absorbs the entire plan and the long tail gets nothing.
 */
const INBOUND_SLACK = 1.5;

export interface ArticleLinkInput {
  /** The planned articles, keyed so the caller can map results back. */
  articles: Array<{ id: string; title: string; keyword: string }>;
  storeCollections?: StoreCollectionItem[];
  /** Proposed collections; only the pushed ones (with a storeHandle) are linkable. */
  proposed?: ProposedCollection[];
  collectionPrefix?: string;
  linksPerArticle?: number;
}

/**
 * Resolves, for each planned article, the collection pages it should link out
 * to. It reuses the same registry, IDF and embedding machinery as the
 * collection graph so an article can only ever point at a verified storefront
 * URL — the handle is read from the store, never minted from the title.
 */
export async function buildArticleLinkTargets(
  input: ArticleLinkInput
): Promise<Record<string, ArticleLinkTarget[]>> {
  const result: Record<string, ArticleLinkTarget[]> = {};
  if (input.articles.length === 0) return result;

  const linksPerArticle = Math.max(1, input.linksPerArticle ?? 4);

  const { nodes } = buildRegistry({
    proposed: input.proposed ?? [],
    storeCollections: input.storeCollections,
    collectionPrefix: input.collectionPrefix,
  });

  const linkable = nodes.filter(
    (node) => node.resolved && node.published && node.productCount > 0
  );
  if (linkable.length === 0) {
    for (const article of input.articles) result[article.id] = [];
    return result;
  }

  const idf = buildIdf(nodes);
  const linkableSparse = new Map<string, Map<string, number>>();
  for (const node of linkable) {
    linkableSparse.set(node.key, tfIdfVector(node.tokens, idf));
  }

  // Embed the collections and the article intents in one pass each.
  let useDense = false;
  if (linkable.length <= MAX_EMBEDDED_NODES) {
    const vectors = await embedTexts(linkable.map((node) => node.embedText));
    linkable.forEach((node, index) => {
      node.vector = vectors[index];
    });
    useDense = vectors.some((vector) => Array.isArray(vector));
  }

  const articleTexts = input.articles.map((article) =>
    [article.title, article.keyword].filter(Boolean).join(". ")
  );
  const articleVectors = useDense ? await embedTexts(articleTexts) : [];

  const maxProducts = Math.max(
    10,
    ...linkable.map((node) => node.productCount || 0)
  );

  // Score every (article, collection) pair once, then allocate globally. Letting
  // each article pick its own top matches independently makes the broadest
  // collection the winner for hundreds of articles at once, which wastes the
  // whole point of internal linking.
  const candidates: Array<{
    articleId: string;
    node: LinkNode;
    score: number;
  }> = [];

  input.articles.forEach((article, index) => {
    const tokens = tokenize(`${article.title} ${article.keyword}`);
    const sparse = tfIdfVector(tokens, idf);
    const vector = articleVectors[index];

    for (const node of linkable) {
      const dense =
        vector && node.vector ? cosineSimilarity(vector, node.vector) : null;
      const lexical = sparseCosine(
        sparse,
        linkableSparse.get(node.key) ?? tfIdfVector(node.tokens, idf)
      );
      const relevance = dense !== null ? 0.7 * dense + 0.3 * lexical : lexical;
      if (relevance < ARTICLE_LINK_THRESHOLD) continue;

      // A small commercial nudge: between two equally relevant pages, send the
      // reader to the one that can actually fulfil the intent.
      const score =
        0.85 * relevance + 0.15 * normalizeLog(node.productCount, maxProducts);
      candidates.push({ articleId: article.id, node, score });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  const inboundCap = Math.max(
    MIN_INBOUND_PER_COLLECTION,
    Math.ceil(
      ((input.articles.length * linksPerArticle) / linkable.length) *
        INBOUND_SLACK
    )
  );

  const chosen = new Map<string, Array<{ node: LinkNode; score: number }>>();
  const inbound = new Map<string, number>();

  const take = (entry: (typeof candidates)[number]) => {
    const list = chosen.get(entry.articleId) ?? [];
    list.push({ node: entry.node, score: entry.score });
    chosen.set(entry.articleId, list);
    inbound.set(entry.node.key, (inbound.get(entry.node.key) ?? 0) + 1);
  };

  // Best pairs first, so a collection's quota goes to the articles that fit it
  // most closely rather than to whichever article happened to be processed first.
  for (const entry of candidates) {
    const list = chosen.get(entry.articleId);
    if (list && list.length >= linksPerArticle) continue;
    if ((inbound.get(entry.node.key) ?? 0) >= inboundCap) continue;
    take(entry);
  }

  // An article left with no links at all is worse than a collection one link
  // over its share, so starved articles get their best match regardless.
  for (const entry of candidates) {
    if ((chosen.get(entry.articleId)?.length ?? 0) > 0) continue;
    take(entry);
  }

  for (const article of input.articles) {
    const usedAnchors = new Set<string>();
    result[article.id] = (chosen.get(article.id) ?? [])
      .sort((a, b) => b.score - a.score)
      .map((entry) => ({
        anchor: sanitizeAnchor(undefined, entry.node, usedAnchors),
        url: entry.node.href,
        collectionName: entry.node.title,
      }));
  }

  return result;
}

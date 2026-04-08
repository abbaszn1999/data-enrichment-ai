import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { GoogleGenAI, ThinkingLevel, createUserContent } from "npm:@google/genai@1";
import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────
interface SourceUrl { title: string; uri: string; }
interface ImageUrl { imageUrl: string; pageUrl: string; title: string; }
interface EnrichedData { [key: string]: any; }
interface CategoryItem { id: string; name: string; slug: string; parentId: string | null; originalId?: string | null; parentName?: string; fullPath: string; children?: CategoryItem[]; }
interface CmsCategoryConfig { columnName: string; hierarchySeparator: string; multiCategorySeparator: string; supportsMultiple: boolean; supportsHierarchy: boolean; notes: string; }
interface AiCallCost { model: string; usage: { promptTokens: number; candidatesTokens: number; thoughtsTokens: number; cachedTokens: number; totalTokens: number }; usedGoogleSearch: boolean; inputCost: number; cachedInputCost: number; outputCost: number; searchCost: number; serperCost: number; totalCost: number; }
interface GeminiSettings { enrichmentModel: string; thinkingLevel: string; outputLanguage: string; }
interface ImagePart { inlineData: { mimeType: string; data: string } }
interface PromptSettings { outputLanguage: string; writingTone: string; customTone: string; contentLength: string; columnSettings?: Record<string, { writingTone?: string; contentLength?: string }>; }

// ─── CMS Category Config ──────────────────────────────────────
const CMS_CATEGORY_CONFIG: Record<string, CmsCategoryConfig> = {
  shopify: { columnName: "Collection", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: false, supportsHierarchy: true, notes: "Shopify uses 'Collection' for grouping products. Only ONE collection per product row in CSV." },
  woocommerce: { columnName: "Categories", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: true, supportsHierarchy: true, notes: "WooCommerce uses comma to separate multiple categories and ' > ' for hierarchy." },
  magento: { columnName: "categories", hierarchySeparator: "/", multiCategorySeparator: ",", supportsMultiple: true, supportsHierarchy: true, notes: "Magento uses '/' for hierarchy path and comma for multiple categories." },
  bigcommerce: { columnName: "Category", hierarchySeparator: "/", multiCategorySeparator: "; ", supportsMultiple: true, supportsHierarchy: true, notes: "BigCommerce uses '/' for hierarchy and ';' to separate multiple categories." },
  prestashop: { columnName: "Categories (x,y,z...)", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: true, supportsHierarchy: false, notes: "PrestaShop uses comma-separated category names." },
  opencart: { columnName: "Categories", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: true, supportsHierarchy: true, notes: "OpenCart uses ' > ' for hierarchy and comma for multiple categories." },
  salla: { columnName: "\u0627\u0644\u062a\u0635\u0646\u064a\u0641\u0627\u062a", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: true, supportsHierarchy: true, notes: "Salla uses ' > ' for hierarchy and comma for multiple. Categories can be in Arabic." },
  zid: { columnName: "\u0627\u0644\u062a\u0635\u0646\u064a\u0641", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: true, supportsHierarchy: true, notes: "Zid uses ' > ' for hierarchy and comma for multiple." },
  amazon: { columnName: "browse_nodes", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: true, supportsHierarchy: true, notes: "Amazon uses browse node paths." },
  noon: { columnName: "categories", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: false, supportsHierarchy: true, notes: "Noon uses ' > ' for hierarchy path." },
};
const DEFAULT_CMS_CATEGORY_CONFIG: CmsCategoryConfig = { columnName: "Categories", hierarchySeparator: " > ", multiCategorySeparator: ", ", supportsMultiple: true, supportsHierarchy: true, notes: "" };

// ─── AI Pricing ───────────────────────────────────────────────
const SERPER_COST_PER_QUERY = 0.001;
const MODEL_PRICING: Record<string, { inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion: number; searchPerQuery: number }> = {
  "gemini-3.1-pro-preview": { inputPerMillion: 2.0, outputPerMillion: 12.0, cachedInputPerMillion: 0.2, searchPerQuery: 0.014 },
  "gemini-3.1-flash-lite-preview": { inputPerMillion: 0.25, outputPerMillion: 1.5, cachedInputPerMillion: 0.025, searchPerQuery: 0.014 },
};
const DEFAULT_PRICING = { inputPerMillion: 2.0, outputPerMillion: 12.0, cachedInputPerMillion: 0.2, searchPerQuery: 0.014 };

function calculateCallCost(model: string, usageMetadata: any, usedGoogleSearch: boolean): AiCallCost {
  const p = MODEL_PRICING[model] || DEFAULT_PRICING;
  const promptTokens = usageMetadata?.promptTokenCount ?? 0;
  const candidatesTokens = usageMetadata?.candidatesTokenCount ?? 0;
  const thoughtsTokens = usageMetadata?.thoughtsTokenCount ?? 0;
  const cachedTokens = usageMetadata?.cachedContentTokenCount ?? 0;
  const totalTokens = usageMetadata?.totalTokenCount ?? 0;
  const nonCachedInput = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (nonCachedInput / 1_000_000) * p.inputPerMillion;
  const cachedInputCost = (cachedTokens / 1_000_000) * p.cachedInputPerMillion;
  const outputCost = ((candidatesTokens + thoughtsTokens) / 1_000_000) * p.outputPerMillion;
  const searchCost = usedGoogleSearch ? p.searchPerQuery : 0;
  return { model, usage: { promptTokens, candidatesTokens, thoughtsTokens, cachedTokens, totalTokens }, usedGoogleSearch, inputCost, cachedInputCost, outputCost, searchCost, serperCost: 0, totalCost: inputCost + cachedInputCost + outputCost + searchCost };
}
function createSerperCost(n = 1): AiCallCost { return { model: "serper-image-search", usage: { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, cachedTokens: 0, totalTokens: 0 }, usedGoogleSearch: false, inputCost: 0, cachedInputCost: 0, outputCost: 0, searchCost: 0, serperCost: n * SERPER_COST_PER_QUERY, totalCost: n * SERPER_COST_PER_QUERY }; }
function costToCredits(d: number) {
  return Math.ceil(d * 10 * 1000) / 1000;
}
function sumCosts(costs: AiCallCost[]) {
  let totalTokens = 0, inputCost = 0, cachedInputCost = 0, outputCost = 0, searchCost = 0, serperCost = 0;
  for (const c of costs) { totalTokens += c.usage.totalTokens; inputCost += c.inputCost; cachedInputCost += c.cachedInputCost; outputCost += c.outputCost; searchCost += c.searchCost; serperCost += c.serperCost; }
  const totalCost = inputCost + cachedInputCost + outputCost + searchCost + serperCost;
  return { totalTokens, totalCost, totalCredits: costToCredits(totalCost) };
}

// ─── Prompts ──────────────────────────────────────────────────
function extractImages(productData: Record<string, string>): { textEntries: string; images: ImagePart[] } {
  const images: ImagePart[] = []; const lines: string[] = [];
  for (const [key, value] of Object.entries(productData)) {
    if (!value || value.trim() === "") continue;
    if (value.startsWith("data:image/")) {
      const match = value.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) { images.push({ inlineData: { mimeType: match[1], data: match[2] } }); lines.push(`- ${key}: [See attached image]`); continue; }
    }
    lines.push(`- ${key}: ${value}`);
  }
  return { textEntries: lines.join("\n"), images };
}

function buildSearchPrompt(productData: Record<string, string>, customInstruction?: string): { text: string; images: ImagePart[] } {
  const { textEntries, images } = extractImages(productData);
  const ai = customInstruction ? `\nAdditional search instruction: ${customInstruction}\n` : "";
  const text = `You are a product research assistant. Search the web to find detailed information about this product.\n${images.length > 0 ? "\nIMPORTANT: I have attached product image(s). Please analyze the image(s) carefully to identify the product, brand, model, and any visible text or features before searching.\n" : ""}\nProduct Data:\n${textEntries}\n${ai}\nSearch for this exact product and find:\n1. The full official product name and model\n2. Detailed technical specifications\n3. Key features and selling points\n4. Product category and subcategory\n5. Any marketing descriptions from official sources or retailers\n\nReturn your findings as a detailed summary. Include all technical specs, features, and marketing angles you find. Be thorough and accurate.`;
  return { text, images };
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: "Use a professional, formal, and business-appropriate tone suitable for e-commerce product listings.",
  persuasive: "Use a persuasive, sales-focused tone that highlights benefits and creates urgency to buy.",
  simple: "Use a simple, clear, and straightforward tone. Avoid jargon and complex sentences.",
  technical: "Use a technical, detailed, and precise tone. Focus on specifications and performance metrics.",
};
const LENGTH_INSTRUCTIONS: Record<string, { description: string; title: string; features: string }> = {
  short: { description: "50-100 words", title: "max 80 chars", features: "3-5" },
  medium: { description: "150-300 words", title: "max 150 chars", features: "5-8" },
  long: { description: "300-500 words", title: "max 200 chars", features: "8-12" },
};
function getBuiltinColumnInstructions(lc: { description: string; title: string; features: string }): Record<string, string> {
  return {
    enhancedTitle: `"enhancedTitle": (string) A professional, SEO-optimized product title (${lc.title}). Include brand, model, key spec.`,
    marketingDescription: `"marketingDescription": (string) A compelling marketing description (${lc.description}). Highlight benefits, use cases, and key specs.`,
    keyFeatures: `"keyFeatures": (array of strings) ${lc.features} key features as short strings.`,
    category: `"category": (string) Product category path like "Electronics > Personal Care > Hair Dryers".`,
    seoKeywords: `"seoKeywords": (array of strings) 8-12 relevant SEO keywords/phrases.`,
    marketplaceBullets: `"marketplaceBullets": (array of strings) 5-7 marketplace-style bullet points.`,
  };
}

function buildEnrichmentPrompt(productData: Record<string, string>, searchResults: string, enabledColumns: string[], enrichmentColumns?: any[], settings?: PromptSettings): { text: string; images: ImagePart[] } {
  const { textEntries, images } = extractImages(productData);
  const contentLength = settings?.contentLength || "medium";
  const lengthConfig = LENGTH_INSTRUCTIONS[contentLength] || LENGTH_INSTRUCTIONS.medium;
  const columnInstructions = enabledColumns.map((colId) => {
    const colSettings = settings?.columnSettings?.[colId];
    const colLength = colSettings?.contentLength || contentLength;
    const colLengthConfig = LENGTH_INSTRUCTIONS[colLength] || lengthConfig;
    const colDef = enrichmentColumns?.find((c: any) => c.id === colId);
    const customInstr = colDef?.customInstruction ? ` Additional instruction: ${colDef.customInstruction}` : "";
    const perColBuiltins = getBuiltinColumnInstructions(colLengthConfig);
    if (perColBuiltins[colId]) return perColBuiltins[colId] + customInstr;
    if (colDef) { const typeHint = colDef.type === "list" ? "(array of strings)" : "(string)"; return `"${colId}": ${typeHint} ${colDef.description}${customInstr}`; }
    return "";
  }).filter(Boolean).join("\n");
  const language = settings?.outputLanguage || "English";
  const toneKeys = new Set<string>();
  if (settings?.columnSettings) { for (const cs of Object.values(settings.columnSettings)) { if (cs.writingTone) toneKeys.add(cs.writingTone); } }
  if (toneKeys.size === 0) toneKeys.add(settings?.writingTone || "professional");
  const toneInstruction = [...toneKeys].map((k) => `- ${TONE_INSTRUCTIONS[k] || TONE_INSTRUCTIONS.professional}`).join("\n");
  const text = `You are an expert e-commerce copywriter and product data specialist. Based on the original product data and research findings below, generate enriched product content.\n${images.length > 0 ? "\nIMPORTANT: Product image(s) are attached. Use them to identify the product accurately.\n" : ""}\nOriginal Product Data:\n${textEntries}\n\nResearch Findings:\n${searchResults}\n\nGenerate a JSON object with ONLY these fields (use exact key names):\n${columnInstructions}\n\nImportant rules:\n- Use the research findings to ensure accuracy\n- Write ALL content in ${language}. Every single field value MUST be in ${language}.\n${toneInstruction}\n- Be specific with technical specs\n- For array fields, return a JSON array of strings\n- For string fields, return a plain string\n- Return ONLY valid JSON, no markdown code blocks, no extra text`;
  return { text, images };
}

// ─── Gemini Client ────────────────────────────────────────────
function getClient(): GoogleGenAI {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 120000 } });
}

function getThinkingLevel(level?: string): any {
  const map: Record<string, any> = { none: undefined, low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };
  return map[level ?? "low"];
}

async function withRetry<T>(op: () => Promise<T>, maxRetries = 2, delayMs = 2000): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try { return await op(); } catch (e: any) {
      lastError = e; console.warn(`[Retry] Attempt ${attempt} failed: ${e?.message}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// ─── Supabase Admin Client ────────────────────────────────────
function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function getOwnerSubscription(workspaceId: string) {
  const admin = getSupabaseAdmin();
  const { data: ws } = await admin.from("workspaces").select("owner_id").eq("id", workspaceId).single();
  if (!ws) return null;
  const ownerId = ws.owner_id;
  const { data: sub } = await admin.from("user_subscriptions").select("*, subscription_plans(*)").eq("user_id", ownerId).single();
  if (!sub) return null;
  return { ownerId, subscription: sub, plan: (sub as any).subscription_plans };
}

function isSubscriptionActive(status: string): boolean {
  return status === "active" || status === "trialing";
}

function calculateCreditBalance(sub: any) {
  if (!sub) {
    return {
      used: 0,
      monthlyTotal: 0,
      monthlyRemaining: 0,
      bonus: 0,
      bonusAvailable: 0,
      bonusLocked: 0,
      total: 0,
      canUseCredits: false,
    };
  }
  const canUseCredits = isSubscriptionActive(sub.status);
  const planCredits = sub.subscription_plans?.monthly_ai_credits ?? 0;
  const monthlyTotal = sub.billing_cycle === "yearly" ? planCredits * 12 : planCredits;
  const used = sub.credits_used ?? 0;
  const bonus = sub.bonus_credits ?? 0;
  const monthlyRemaining = canUseCredits ? Math.max(0, monthlyTotal - used) : 0;
  const bonusAvailable = canUseCredits ? bonus : 0;
  const bonusLocked = canUseCredits ? 0 : bonus;
  return {
    used,
    monthlyTotal,
    monthlyRemaining,
    bonus,
    bonusAvailable,
    bonusLocked,
    total: monthlyRemaining + bonusAvailable,
    canUseCredits,
  };
}

// ─── Core Functions ───────────────────────────────────────────
async function resolveRedirectUrl(url: string): Promise<string> {
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: c.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; DataSheetAI/1.0)" } });
    clearTimeout(t); return res.url || url;
  } catch { return url; }
}

async function resolveSourceUrls(sources: SourceUrl[]): Promise<SourceUrl[]> {
  return await Promise.all(sources.map(async (s) => {
    if (s.uri.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) {
      const realUrl = await resolveRedirectUrl(s.uri); return { ...s, uri: realUrl };
    }
    return s;
  }));
}

async function searchProduct(productData: Record<string, string>, customInstruction?: string): Promise<{ text: string; sources: SourceUrl[]; cost: AiCallCost }> {
  return withRetry(async () => {
    const ai = getClient();
    const { text: promptText, images } = buildSearchPrompt(productData, customInstruction);
    const parts: any[] = [{ text: promptText }]; for (const img of images) parts.push(img);
    const response = await ai.models.generateContent({ model: "gemini-3.1-pro-preview", contents: createUserContent(parts), config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
    const text = response.text || "";
    const cost = calculateCallCost("gemini-3.1-pro-preview", response.usageMetadata, true);
    const sources: SourceUrl[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (chunks) { for (const chunk of chunks) { if (chunk.web?.uri && chunk.web?.title) sources.push({ title: chunk.web.title, uri: chunk.web.uri }); } }
    const resolvedSources = await resolveSourceUrls(sources);
    return { text, sources: resolvedSources, cost };
  }, 2, 2000);
}

async function validateImageUrl(url: string): Promise<boolean> {
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 5000);
    const res = await fetch(url, { method: "HEAD", signal: c.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; DataSheetAI/1.0)" }, redirect: "follow" });
    clearTimeout(t); if (!res.ok) return false;
    return (res.headers.get("content-type") || "").startsWith("image/");
  } catch { return false; }
}

async function filterValidImages(images: ImageUrl[]): Promise<ImageUrl[]> {
  const results = await Promise.all(images.map(async (img) => { const ok = await validateImageUrl(img.imageUrl); return ok ? img : null; }));
  return results.filter(Boolean) as ImageUrl[];
}

async function analyzeProductData(productData: Record<string, string>, settings?: GeminiSettings): Promise<{ sufficient: boolean; searchQuery: string; productIdentity: string; cost: AiCallCost | null }> {
  const ai = getClient();
  const model = settings?.enrichmentModel || "gemini-3.1-pro-preview";
  const thinkingLvl = getThinkingLevel(settings?.thinkingLevel);
  const dataLines: string[] = [];
  for (const [key, value] of Object.entries(productData)) {
    if (!value || value.trim() === "") continue;
    dataLines.push(value.startsWith("data:image/") ? `- ${key}: [image attached]` : `- ${key}: ${value}`);
  }
  const prompt = `Analyze the following product data and determine:\n1. Can you clearly identify what this product is?\n2. Is the data sufficient to search for product images on Google?\n3. Generate the best possible English search query to find images of this EXACT product.\n\nProduct Data:\n${dataLines.join("\n")}\n\nRules:\n- If you can identify the product clearly, mark as sufficient.\n- The search query MUST be in English.\n- Do NOT guess or fabricate product details.\n\nRespond ONLY with a valid JSON object:\n{"sufficient": true/false, "searchQuery": "brand product-type model-number", "productIdentity": "brief description"}`;
  try {
    const response = await ai.models.generateContent({ model, contents: createUserContent([{ text: prompt }]), config: { responseMimeType: "application/json", ...(thinkingLvl != null ? { thinkingConfig: { thinkingLevel: thinkingLvl } } : {}) } });
    const result = JSON.parse(response.text || "{}");
    const cost = calculateCallCost(model, response.usageMetadata, false);
    return { sufficient: !!result.sufficient, searchQuery: result.searchQuery || "", productIdentity: result.productIdentity || "", cost };
  } catch (err: any) { console.warn(`[AI Analysis] Failed: ${err.message}`); return { sufficient: false, searchQuery: "", productIdentity: "", cost: null }; }
}

async function serperImageSearch(searchQuery: string, imageCount: number): Promise<ImageUrl[]> {
  const apiKey = Deno.env.get("SERPER_API_KEY");
  if (!apiKey || !searchQuery.trim()) return [];
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 10000);
    const res = await fetch("https://google.serper.dev/images", { method: "POST", headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ q: searchQuery, num: Math.min(imageCount + 5, 20) }), signal: c.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json(); const images: ImageUrl[] = []; const seen = new Set<string>();
    if (data.images && Array.isArray(data.images)) {
      for (const img of data.images) {
        if (!img.imageUrl || seen.has(img.imageUrl)) continue;
        if ((img.imageWidth || 0) > 0 && (img.imageWidth || 0) < 150) continue;
        if ((img.imageHeight || 0) > 0 && (img.imageHeight || 0) < 150) continue;
        seen.add(img.imageUrl); images.push({ imageUrl: img.imageUrl, pageUrl: img.link || "", title: img.title || "Product image" });
      }
    }
    return images.slice(0, imageCount + 3);
  } catch { return []; }
}

async function searchProductImages(productData: Record<string, string>, imageCount = 3, customInstruction = "", settings?: GeminiSettings, preBuiltQuery?: string): Promise<ImageUrl[]> {
  return withRetry(async () => {
    let searchQuery = preBuiltQuery || "";
    if (!searchQuery) { const analysis = await analyzeProductData(productData, settings); searchQuery = analysis.searchQuery; }
    if (!searchQuery) return [];
    if (customInstruction) searchQuery = `${searchQuery} ${customInstruction}`.trim();
    const candidates = await serperImageSearch(searchQuery, imageCount);
    if (candidates.length === 0) return [];
    const validated = await filterValidImages(candidates);
    return validated.slice(0, imageCount);
  }, 2, 3000);
}

function repairTruncatedJson(text: string): string | null {
  let repaired = text.trim();
  const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) { const lastComplete = repaired.lastIndexOf('",' ); if (lastComplete > 0) repaired = repaired.slice(0, lastComplete + 1); else repaired += '"'; }
  repaired = repaired.replace(/,\s*$/, "");
  let openBraces = 0, openBrackets = 0, inString = false;
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (ch === '"' && (i === 0 || repaired[i - 1] !== "\\")) inString = !inString;
    if (!inString) { if (ch === "{") openBraces++; else if (ch === "}") openBraces--; else if (ch === "[") openBrackets++; else if (ch === "]") openBrackets--; }
  }
  for (let i = 0; i < openBrackets; i++) repaired += "]";
  for (let i = 0; i < openBraces; i++) repaired += "}";
  try { JSON.parse(repaired); return repaired; } catch { return null; }
}

async function enrichProduct(productData: Record<string, string>, searchResults: string, enabledColumns: string[], enrichmentColumns?: any[], settings?: GeminiSettings): Promise<{ data: EnrichedData; cost: AiCallCost }> {
  return withRetry(async () => {
    const ai = getClient();
    const promptSettings: PromptSettings = { outputLanguage: settings?.outputLanguage || "English", writingTone: "professional", customTone: "", contentLength: "medium", columnSettings: enrichmentColumns?.reduce((acc: any, col: any) => { if (col.writingTone || col.contentLength) acc[col.id] = { writingTone: col.writingTone, contentLength: col.contentLength }; return acc; }, {}) || {} };
    const { text: promptText, images } = buildEnrichmentPrompt(productData, searchResults, enabledColumns, enrichmentColumns, promptSettings);
    const parts: any[] = [{ text: promptText }]; for (const img of images) parts.push(img);
    const model = settings?.enrichmentModel || "gemini-3.1-pro-preview";
    const thinkingLvl = getThinkingLevel(settings?.thinkingLevel);
    const response = await ai.models.generateContent({ model, contents: createUserContent(parts), config: { responseMimeType: "application/json", maxOutputTokens: 65536, ...(thinkingLvl != null ? { thinkingConfig: { thinkingLevel: thinkingLvl } } : {}) } });
    const text = response.text || "{}";
    const cost = calculateCallCost(model, response.usageMetadata, false);
    let parsed: EnrichedData;
    try { parsed = JSON.parse(text); } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[0]); } catch { const repaired = repairTruncatedJson(jsonMatch[0]); if (repaired) { try { parsed = JSON.parse(repaired); } catch { throw new Error(`Failed to parse AI response`); } } else throw new Error(`Failed to parse AI response`); } }
      else throw new Error(`Failed to parse AI response`);
    }
    return { data: parsed, cost };
  }, 2, 3000);
}

async function categorizeProduct(productData: Record<string, string>, searchResults: string, settings?: GeminiSettings, cmsType?: string, workspaceCategories?: CategoryItem[], maxCategories = 3, customInstruction = "", categoriesRawRows?: Record<string, string>[]): Promise<{ categories: string; cost: AiCallCost | null }> {
  const ai = getClient();
  const model = settings?.enrichmentModel || "gemini-3.1-pro-preview";
  const thinkingLvl = getThinkingLevel(settings?.thinkingLevel);
  const cmsConfig = cmsType && CMS_CATEGORY_CONFIG[cmsType] ? CMS_CATEGORY_CONFIG[cmsType] : DEFAULT_CMS_CATEGORY_CONFIG;
  const { textEntries } = extractImages(productData);
  let categoriesSection = ""; const hasCategories = workspaceCategories && workspaceCategories.length > 0;
  const isBigCommerce = cmsType === "bigcommerce";
  let formattingRules = "";
  if (isBigCommerce && categoriesRawRows && categoriesRawRows.length > 0) {
    const cols = Object.keys(categoriesRawRows[0]); const header = cols.join(" | "); const rows = categoriesRawRows.map(r => cols.map(c => r[c] ?? "").join(" | ")).join("\n");
    categoriesSection = `\nAVAILABLE CATEGORIES (BigCommerce):\n${header}\n${rows}\n\nIMPORTANT: Pick ONLY from these categories.`;
    formattingRules = `\nCMS Platform: bigcommerce\nFORMATTING RULES:\n- Pick up to ${maxCategories} categories.\n- Output: deepest category_id;parent_id;...up to root.\n- Separate chains with "; ".`;
  } else if (hasCategories) {
    const categoryList = workspaceCategories!.map(c => `- ${c.fullPath}`).join("\n");
    categoriesSection = `\nAVAILABLE CATEGORIES:\n${categoryList}\n\nIMPORTANT: Pick ONLY from this list.`;
    const maxCats = cmsConfig.supportsMultiple ? maxCategories : 1;
    formattingRules = `\nCMS Platform: ${cmsType || "generic"}\nColumn Name: ${cmsConfig.columnName}\n${cmsConfig.notes}\n\nFORMATTING RULES:\n- ${cmsConfig.supportsMultiple ? `Up to ${maxCats} categories` : "Exactly 1 category"}\n- ${cmsConfig.supportsHierarchy ? `Use "${cmsConfig.hierarchySeparator}" for hierarchy` : "Leaf category names only"}\n- ${cmsConfig.supportsMultiple ? `Separate with "${cmsConfig.multiCategorySeparator}"` : "Only one category"}`;
  } else {
    categoriesSection = `\nNo predefined categories available. Suggest appropriate categories.`;
    const maxCats = cmsConfig.supportsMultiple ? maxCategories : 1;
    formattingRules = `\nCMS Platform: ${cmsType || "generic"}\n- ${cmsConfig.supportsMultiple ? `Up to ${maxCats} categories` : "Exactly 1 category"}`;
  }
  const instruction = customInstruction ? `\nAdditional instruction: ${customInstruction}` : "";
  const prompt = `You are a product categorization expert. Assign the most relevant categories to this product.\n\nProduct Data:\n${textEntries}\n\n${searchResults ? `Product Research:\n${searchResults.slice(0, 800)}\n` : ""}${categoriesSection}${formattingRules}${instruction}\n\nRespond ONLY with a valid JSON object:\n{"categories": "formatted category string", "reasoning": "brief explanation"}`;
  try {
    const response = await ai.models.generateContent({ model, contents: createUserContent([{ text: prompt }]), config: { responseMimeType: "application/json", ...(thinkingLvl != null ? { thinkingConfig: { thinkingLevel: thinkingLvl } } : {}) } });
    const result = JSON.parse(response.text || "{}");
    const cost = calculateCallCost(model, response.usageMetadata, false);
    return { categories: result.categories || "", cost };
  } catch (err: any) { console.warn(`[Categories] Failed: ${err.message}`); return { categories: "", cost: null }; }
}

// ─── Main enrichProductRow ────────────────────────────────────
async function enrichProductRow(productData: Record<string, string>, enabledColumns: string[], enrichmentColumns?: any[], settings?: GeminiSettings, cmsType?: string, workspaceCategories?: CategoryItem[], categoriesRawRows?: Record<string, string>[]): Promise<{ data: EnrichedData; costs: AiCallCost[] }> {
  const costs: AiCallCost[] = [];
  const specialColumns = ["sourceUrls", "imageUrls", "categories"];
  const columnsToGenerate = enabledColumns.filter(c => !specialColumns.includes(c));
  const needsEnrich = columnsToGenerate.length > 0;
  const needsSources = enabledColumns.includes("sourceUrls");
  const needsImages = enabledColumns.includes("imageUrls");
  const needsCategories = enabledColumns.includes("categories");
  let needsSearch = needsEnrich || needsSources;
  let imageSearchQuery = "";
  if (!needsSearch && (needsImages || needsCategories)) {
    const analysis = await analyzeProductData(productData, settings);
    if (analysis.cost) costs.push(analysis.cost);
    if (analysis.sufficient) { imageSearchQuery = analysis.searchQuery; } else { needsSearch = true; }
  }
  let searchResults = ""; let sources: SourceUrl[] = [];
  if (needsSearch) {
    const sourceCol = enrichmentColumns?.find((c: any) => c.id === "sourceUrls");
    const result = await searchProduct(productData, sourceCol?.customInstruction);
    searchResults = result.text; sources = result.sources; costs.push(result.cost);
    if (needsImages && !imageSearchQuery) {
      const enrichedPD = { ...productData, "__searchResults": searchResults.slice(0, 500) };
      const analysis = await analyzeProductData(enrichedPD, settings);
      if (analysis.cost) costs.push(analysis.cost);
      imageSearchQuery = analysis.searchQuery;
    }
  }
  let enrichedData: EnrichedData = {};
  if (needsEnrich) {
    const enrichResult = await enrichProduct(productData, searchResults, columnsToGenerate, enrichmentColumns, settings);
    enrichedData = enrichResult.data; costs.push(enrichResult.cost);
  }
  if (needsSources) enrichedData.sourceUrls = sources;
  if (needsCategories) {
    const catCol = enrichmentColumns?.find((c: any) => c.id === "categories");
    try {
      const catResult = await categorizeProduct(productData, searchResults, settings, cmsType, workspaceCategories, catCol?.maxCategories ?? 3, catCol?.customInstruction ?? "", categoriesRawRows);
      enrichedData.categories = catResult.categories;
      if (catResult.cost) costs.push(catResult.cost);
    } catch (e: any) { enrichedData.categories = ""; }
  }
  if (needsImages) {
    const imageCol = enrichmentColumns?.find((c: any) => c.id === "imageUrls");
    try {
      const imageResults = await searchProductImages(productData, imageCol?.imageCount ?? 3, imageCol?.customInstruction ?? "", settings, imageSearchQuery || undefined);
      enrichedData.imageUrls = imageResults; costs.push(createSerperCost(1));
    } catch { enrichedData.imageUrls = []; }
  }
  const total = sumCosts(costs);
  console.log(`[Enrich] Row total: $${total.totalCost.toFixed(6)} (${total.totalTokens} tokens, ${total.totalCredits} credits)`);
  return { data: enrichedData, costs };
}

// ─── HTTP Handler ─────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { row, enabledColumns, enrichmentColumns, settings, cmsType, workspaceCategories, categoriesRawRows, workspaceId, userId } = body;

    if (!row) return new Response(JSON.stringify({ error: "No row provided" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    if (!enabledColumns || enabledColumns.length === 0) return new Response(JSON.stringify({ error: "No enrichment columns selected" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

    // Check credits before enrichment
    if (workspaceId) {
      try {
        const ownerSub = await getOwnerSubscription(workspaceId);
        if (ownerSub) {
          if (!isSubscriptionActive(ownerSub.subscription.status)) {
            console.log(`[Credits] Subscription inactive: ${ownerSub.subscription.status}`);
            return new Response(JSON.stringify({ error: "INACTIVE_SUBSCRIPTION" }), { status: 402, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
          }
          const bal = calculateCreditBalance(ownerSub.subscription);
          console.log(`[Credits] Balance check: monthlyTotal=${bal.monthlyTotal}, monthlyRemaining=${bal.monthlyRemaining}, bonus=${bal.bonus}, bonusAvailable=${bal.bonusAvailable}, bonusLocked=${bal.bonusLocked}, total=${bal.total}`);
          if (!bal.canUseCredits || bal.total <= 0) {
            return new Response(JSON.stringify({ error: "NO_CREDITS" }), { status: 402, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
          }
        }
      } catch (err: any) {
        console.warn(`[Credits] Check failed (allowing): ${err?.message}`);
      }
    }

    console.log(`[API] Starting enrichment for row ${row.rowIndex}`);
    const enrichedData = await enrichProductRow(row.originalData, enabledColumns, enrichmentColumns, settings, cmsType, workspaceCategories, categoriesRawRows);
    console.log(`[API] Success for row ${row.rowIndex}`);

    const rowCostSummary = enrichedData.costs ? sumCosts(enrichedData.costs) : null;

    // Deduct credits after successful enrichment
    if (workspaceId && rowCostSummary && rowCostSummary.totalCredits > 0) {
      try {
        const admin = getSupabaseAdmin();
        const ownerSub = await getOwnerSubscription(workspaceId);
        if (ownerSub && isSubscriptionActive(ownerSub.subscription.status)) {
          const { data: deductResult, error: deductError } = await admin.rpc("deduct_user_credits", {
            p_user_id: ownerSub.ownerId,
            p_amount: rowCostSummary.totalCredits,
            p_workspace_id: workspaceId,
            p_operation: "ai_enrichment",
            p_uid: userId || ownerSub.ownerId,
            p_details: { rowIndex: row.rowIndex },
          });

          if (deductError) {
            console.error(`[Credits] RPC deduct_user_credits FAILED: ${deductError.message}`, JSON.stringify(deductError));
          } else if (deductResult && !deductResult.success) {
            console.warn(`[Credits] Deduction rejected: ${deductResult.error}`, JSON.stringify(deductResult));
          } else {
            console.log(`[Credits] Deducted ${rowCostSummary.totalCredits} credits for row ${row.rowIndex}. Remaining: ${deductResult?.remaining}`);
          }
        } else {
          console.warn("[Credits] Skipping deduction — subscription inactive after enrichment");
        }
      } catch (err: any) {
        console.error(`[Credits] Deduction EXCEPTION: ${err?.message}`, err?.stack);
      }
    }

    return new Response(JSON.stringify({
      status: "done",
      id: row.id,
      rowIndex: row.rowIndex,
      data: enrichedData.data,
      cost: rowCostSummary ? { totalCost: rowCostSummary.totalCost, totalCredits: rowCostSummary.totalCredits, totalTokens: rowCostSummary.totalTokens } : undefined,
    }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  } catch (error: any) {
    console.error(`[API] Error:`, error);
    return new Response(JSON.stringify({ status: "error", error: error?.message || "Unknown error" }), { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }
});

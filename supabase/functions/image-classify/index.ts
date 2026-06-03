import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { GoogleGenAI } from "npm:@google/genai@1";
import { createClient } from "npm:@supabase/supabase-js@2";

type RequestImage = { id: string; filename: string; storagePath: string; mimeType?: string };
type RequestBody = { workspaceId?: string; sessionId?: string; images?: RequestImage[]; instruction?: string; thinkingLevel?: string };
type GeminiGroup = { id: string; label: string; description?: string; imageIds: string[] };
type GeminiResult = { groups: GeminiGroup[]; items: Array<{ id: string; groupId: string; sku?: string; confidence?: number; notes?: string }> };
type ImageClassificationGroup = { id: string; label: string; description?: string; imageIds: string[] };
type ImageClassificationItem = { id: string; filename: string; storagePath: string; url: string; groupId: string; groupLabel: string; sku?: string; confidence?: number; notes?: string };
type AiCallCost = { usage: { promptTokens: number; candidatesTokens: number; thoughtsTokens: number; cachedTokens: number; totalTokens: number }; totalCost: number };

type OwnerSubscription = { ownerId: string; subscription: any };

const MODEL = "gemini-3.5-flash";
const MAX_IMAGES = 200;
const SIGNED_URL_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

let adminClient: ReturnType<typeof createClient> | null = null;
function getAdmin() {
  if (!adminClient) {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    adminClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return adminClient;
}

function isSubscriptionActive(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

function roundCredits(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function calculateCreditBalance(sub: any) {
  if (!sub) return { total: 0, canUseCredits: false };
  const canUseCredits = isSubscriptionActive(sub.status);
  const planCredits = roundCredits(sub.subscription_plans?.monthly_ai_credits ?? 0);
  const monthlyTotal = sub.billing_cycle === "yearly" ? roundCredits(planCredits * 12) : planCredits;
  const monthlyRemaining = canUseCredits ? roundCredits(Math.max(0, monthlyTotal - (sub.credits_used ?? 0))) : 0;
  const bonusAvailable = canUseCredits ? roundCredits(sub.bonus_credits ?? 0) : 0;
  return { total: roundCredits(monthlyRemaining + bonusAvailable), canUseCredits };
}

async function getOwnerSubscription(workspaceId: string): Promise<OwnerSubscription | null> {
  const admin = getAdmin();
  const { data: workspace } = await admin.from("workspaces").select("owner_id").eq("id", workspaceId).single();
  if (!workspace?.owner_id) return null;
  const { data: sub } = await admin.from("user_subscriptions").select("*, subscription_plans(*)").eq("user_id", workspace.owner_id).single();
  if (!sub) return null;
  return { ownerId: String(workspace.owner_id), subscription: sub };
}

function calculateCallCost(usageMetadata: any): AiCallCost {
  const promptTokens = usageMetadata?.promptTokenCount ?? 0;
  const candidatesTokens = usageMetadata?.candidatesTokenCount ?? 0;
  const thoughtsTokens = usageMetadata?.thoughtsTokenCount ?? 0;
  const cachedTokens = usageMetadata?.cachedContentTokenCount ?? 0;
  const totalTokens = usageMetadata?.totalTokenCount ?? 0;
  const inputCost = (Math.max(0, promptTokens - cachedTokens) / 1_000_000) * 0.3;
  const cachedInputCost = (cachedTokens / 1_000_000) * 0.03;
  const outputCost = ((candidatesTokens + thoughtsTokens) / 1_000_000) * 2.5;
  return { usage: { promptTokens, candidatesTokens, thoughtsTokens, cachedTokens, totalTokens }, totalCost: inputCost + cachedInputCost + outputCost };
}

function costToCredits(cost: number) {
  return Math.ceil(cost * 10 * 1000) / 1000;
}

async function deductCreditsStrict(params: {
  ownerSub: OwnerSubscription;
  credits: number;
  workspaceId: string;
  userId: string;
  sessionId: string;
  imageCount: number;
  groupCount: number;
  totalCost: number;
  totalTokens: number;
  thinkingLevel?: string;
}) {
  const admin = getAdmin();
  if (params.credits <= 0) return;
  const ownerUserId = params.ownerSub.subscription?.user_id || params.ownerSub.ownerId;
  const { data: deductResult, error: deductError } = await admin.rpc("deduct_user_credits", {
    p_user_id: ownerUserId,
    p_amount: params.credits,
    p_workspace_id: params.workspaceId,
    p_operation: "image_classification",
    p_uid: params.userId || ownerUserId,
    p_entity_type: "image_classification_session",
    p_entity_id: params.sessionId,
    p_details: {
      model: MODEL,
      imageCount: params.imageCount,
      groupCount: params.groupCount,
      totalCost: params.totalCost,
      totalTokens: params.totalTokens,
      thinkingLevel: params.thinkingLevel || "medium",
    },
  });
  if (deductError) throw new Error(`Credit deduction failed: ${deductError.message}`);
  if (!deductResult?.success) {
    throw new Error(`Credit deduction rejected: ${deductResult?.error || "Insufficient credits"}`);
  }
  console.log(`[image-classify] Deducted ${params.credits} credits. Remaining: ${deductResult.remaining}`);
}

function buildSystemInstruction(): string {
  return [
    "You are a senior ecommerce product image classification specialist.",
    "Your job is to group images by the actual product being sold, not by brand alone, visual theme alone, color alone, or broad category alone.",
    "A group must contain images that plausibly represent the same product, the same product family, or intentionally equivalent variants according to the customer's instruction.",
    "Never group fundamentally different product types together. Shoes, sandals, bags, wallets, belts, hats, shirts, pants, shorts, dresses, cups, saucers, toys, and accessories must be separate unless the customer explicitly asks to group them together.",
    "When uncertain between merging and splitting, choose splitting. Over-splitting is better than mixing unrelated products.",
    "Every image MUST be assigned to exactly one group.",
    "Return JSON only, matching the provided schema. Do not invent image ids; use only the ids that appear in the user prompt.",
    "For each image, you must also extract the SKU code from the image filename. If the customer's custom instruction explains where the SKU is located in the filename, follow it exactly. If there is no custom instruction about the SKU, identify the most plausible part of the filename that represents an SKU (e.g. model numbers, alphanumeric strings, or patterns like COSH261032-RAIN-11, HK5000030_584, cw637) and output it as the 'sku' field for the item. If no SKU can be identified, output an empty string.",
    "CRITICAL RULE: If multiple images share the exact same extracted SKU code, they MUST be assigned to the exact same product group, as they represent the same product or variant. Use the SKU as a strong constraint for grouping."
  ].join(" ");
}

function buildUserPrompt(images: RequestImage[], instruction: string | undefined): string {
  const lines: string[] = [];
  lines.push(`Classify the following ${images.length} ecommerce product images into accurate product groups.`);
  lines.push("Primary goal: maximize precision and avoid false merges. Do not mix unrelated products in the same group.");
  lines.push(
    "Use this decision process for every image:",
    "1. Identify the product type first (for example sneaker, sandal, handbag, wallet, t-shirt, pants, shorts, cup, saucer, hat, toy).",
    "2. Identify the visible product details: shape, silhouette, construction, material, pattern, logo placement, colorway, heel/sole type, handle/strap type, closure type, and whether it is apparel, footwear, bag, tableware, or accessory.",
    "3. Compare images only after product type is clear.",
    "4. Put two images in the same group only if they show the same product, the same matching set, or very close variants of the same item.",
    "5. If two images share a brand but have different product types, separate them.",
    "6. If two images share a color but have different product types, separate them.",
    "7. If a group would contain both footwear and bags/accessories/apparel/tableware, split it.",
    "8. If a group would contain multiple unrelated subcategories, split it into smaller precise groups."
  );
  lines.push(
    "Examples of forbidden merges:",
    "- Do not group sneakers with handbags.",
    "- Do not group sandals with wallets or shoulder bags.",
    "- Do not group shirts with pants or shorts unless instructed to create outfits.",
    "- Do not group cups/saucers with non-tableware products.",
    "- Do not group all items from the same designer or brand together if the actual products differ."
  );
  lines.push(
    "Group label rules:",
    "- Use concise ecommerce labels that describe the product type and distinguishing details.",
    "- Do not label a group with only the brand name.",
    "- If brand is visible or inferable from filenames, include it only after the product type is correct.",
    "- The description must explain why the images belong together and what separates them from nearby groups."
  );
  if (instruction && instruction.trim()) {
    lines.push(
      "CUSTOM INSTRUCTION FROM THE CUSTOMER:",
      instruction.trim(),
      "You MUST follow the custom instruction above when creating groups, labels, and assignments unless it directly conflicts with assigning every image exactly once or would force unrelated product types into the same group."
    );
  }
  lines.push("Image catalog (id \u2192 filename):");
  for (const img of images) lines.push(`- ${img.id} \u2192 ${img.filename}`);
  lines.push("Each image is provided in order below this prompt as inlineData parts.");
  lines.push("Output JSON with: groups[{id,label,description,imageIds[]}] and items[{id,groupId,confidence,notes}].");
  lines.push("For each item, notes should briefly state the visual reason for its group assignment.");
  lines.push("Before finalizing, audit every group and split any group that contains mixed product types or weak visual similarity.");
  lines.push("All image ids must appear in items exactly once.");
  return lines.join("\n");
}

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["groups", "items"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "imageIds"],
        properties: {
          id: { type: "string", description: "Stable group id created by the model, such as group_1." },
          label: { type: "string", description: "Concise ecommerce product-group label focused on product type and distinguishing details, not brand alone." },
          description: { type: "string", description: "Short explanation of why these images belong together and why they are separate from other groups." },
          imageIds: { type: "array", description: "Image ids assigned to this precise product group. Do not include unrelated product types.", items: { type: "string" } },
        },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "groupId"],
        properties: {
          id: { type: "string", description: "The exact image id from the prompt." },
          groupId: { type: "string", description: "The id of the precise product group this image belongs to." },
          sku: { type: "string", description: "The SKU code extracted from the image filename, following the customer's instruction if provided, or otherwise identifying the most plausible SKU code in the filename." },
          confidence: { type: "number", description: "Confidence from 0 to 1 for this image's group assignment." },
          notes: { type: "string", description: "Brief visual reason for the assignment, including product type and distinguishing details." },
        },
      },
    },
  },
};

async function downloadImage(storagePath: string): Promise<{ data: string; mimeType: string } | null> {
  const { data, error } = await getAdmin().storage.from("workspace-files").download(storagePath);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return { data: btoa(binary), mimeType: data.type || "image/jpeg" };
}

async function runClassificationJob(payload: Required<Pick<RequestBody, "workspaceId" | "sessionId" | "images">> & { instruction?: string; thinkingLevel?: string; userId: string; ownerSub: OwnerSubscription }) {
  const admin = getAdmin();
  const { workspaceId, sessionId, images, instruction, thinkingLevel, userId, ownerSub } = payload;
  try {
    const downloads = await Promise.all(images.map((img) => downloadImage(img.storagePath)));
    const inlineParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    const validImages: RequestImage[] = [];
    downloads.forEach((d, i) => {
      if (d) {
        validImages.push(images[i]);
        inlineParts.push({ inlineData: { mimeType: images[i].mimeType || d.mimeType || "image/jpeg", data: d.data } });
      }
    });
    if (validImages.length === 0) throw new Error("Failed to download any image from storage");

    const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    if (!apiKey) throw new Error("AI service not configured (GEMINI_API_KEY missing)");
    const ai = new GoogleGenAI({ apiKey });
    const userPrompt = buildUserPrompt(validImages, instruction);
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: userPrompt }, ...inlineParts] }],
      config: {
        systemInstruction: buildSystemInstruction(),
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingLevel: thinkingLevel || "medium" },
      } as any,
    } as any);

    const rawText = response.text ?? "";
    if (!rawText) throw new Error("Empty response from model");
    let parsed: GeminiResult;
    try {
      parsed = JSON.parse(rawText) as GeminiResult;
    } catch (err) {
      throw new Error(`Failed to parse model output as JSON: ${(err as Error).message}`);
    }

    const cost = calculateCallCost(response.usageMetadata);
    const credits = costToCredits(cost.totalCost);
    const groupsById = new Map<string, ImageClassificationGroup>();
    for (const g of parsed.groups || []) {
      if (!g?.id) continue;
      groupsById.set(g.id, { id: g.id, label: g.label, description: g.description, imageIds: Array.isArray(g.imageIds) ? g.imageIds : [] });
    }
    const itemByImageId = new Map<string, { groupId: string; sku?: string; confidence?: number; notes?: string }>();
    for (const it of parsed.items || []) {
      if (it && typeof it.id === "string") itemByImageId.set(it.id, { groupId: it.groupId, sku: it.sku, confidence: it.confidence, notes: it.notes });
    }

    const paths = validImages.map((img) => img.storagePath);
    const urlByPath = new Map<string, string>();
    try {
      const { data: signed } = await admin.storage.from("workspace-files").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      (signed ?? []).forEach((row: any, i: number) => {
        if (row?.signedUrl) urlByPath.set(paths[i], row.signedUrl);
      });
    } catch (err) {
      console.warn("[image-classify] createSignedUrls failed:", (err as Error).message);
    }

    const items: ImageClassificationItem[] = [];
    for (const img of validImages) {
      const it = itemByImageId.get(img.id);
      let groupId = it?.groupId;
      if (!groupId || !groupsById.has(groupId)) {
        groupId = "unclassified";
        if (!groupsById.has(groupId)) groupsById.set(groupId, { id: groupId, label: "Unclassified", description: "Images the model did not assign to a group", imageIds: [] });
        const g = groupsById.get(groupId)!;
        if (!g.imageIds.includes(img.id)) g.imageIds.push(img.id);
      }
      const group = groupsById.get(groupId)!;
      items.push({ id: img.id, filename: img.filename, storagePath: img.storagePath, url: urlByPath.get(img.storagePath) ?? "", groupId, groupLabel: group.label, sku: it?.sku ?? "", confidence: it?.confidence, notes: it?.notes });
    }

    const result = {
      sessionId,
      model: MODEL,
      thinkingLevel: thinkingLevel || "medium",
      createdAt: new Date().toISOString(),
      totalImages: validImages.length,
      groups: Array.from(groupsById.values()),
      items,
      usage: { promptTokens: cost.usage.promptTokens, candidatesTokens: cost.usage.candidatesTokens, totalTokens: cost.usage.totalTokens, totalCost: cost.totalCost, totalCredits: credits },
    };

    // Deduct credits BEFORE saving result - if insufficient, session fails
    await deductCreditsStrict({ ownerSub, credits, workspaceId, userId, sessionId, imageCount: validImages.length, groupCount: result.groups.length, totalCost: cost.totalCost, totalTokens: cost.usage.totalTokens, thinkingLevel });

    // Upload result JSON using application/octet-stream (matching project convention for workspace-files bucket)
    const storagePath = `${workspaceId}/image-classification/${sessionId}/result.json`;
    const jsonBlob = new Blob([JSON.stringify(result)], { type: "application/octet-stream" });
    const { error: uploadError } = await admin.storage.from("workspace-files").upload(storagePath, jsonBlob, { cacheControl: "0", upsert: true });
    if (uploadError) throw uploadError;

    await admin.from("image_classification_sessions").update({ status: "completed", group_count: result.groups.length, storage_path: storagePath, total_cost: cost.totalCost, total_credits: credits, total_tokens: cost.usage.totalTokens, error_message: null }).eq("id", sessionId);
    console.log(`[image-classify] Session ${sessionId} completed: ${result.groups.length} groups, ${credits} credits deducted`);
  } catch (err) {
    const message = (err as Error).message || "Classification failed";
    await admin.from("image_classification_sessions").update({ status: "failed", error_message: message }).eq("id", sessionId);
    console.error("[image-classify] failed:", message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  const jsonHeaders = { "Content-Type": "application/json", ...CORS_HEADERS };
  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: jsonHeaders });
    const admin = getAdmin();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: jsonHeaders });

    const body = (await req.json()) as RequestBody;
    const { workspaceId, sessionId, images = [], instruction, thinkingLevel } = body;
    if (!workspaceId || !sessionId) return new Response(JSON.stringify({ error: "Missing workspaceId or sessionId" }), { status: 400, headers: jsonHeaders });
    if (!Array.isArray(images) || images.length === 0) return new Response(JSON.stringify({ error: "No images provided" }), { status: 400, headers: jsonHeaders });
    if (images.length > MAX_IMAGES) return new Response(JSON.stringify({ error: `Too many images (max ${MAX_IMAGES})` }), { status: 400, headers: jsonHeaders });

    const { data: member, error: memberError } = await admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).single();
    if (memberError || !member || member.role === "viewer") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: jsonHeaders });

    const { data: sessionRow, error: sessionError } = await admin.from("image_classification_sessions").select("id, workspace_id").eq("id", sessionId).single();
    if (sessionError || !sessionRow || sessionRow.workspace_id !== workspaceId) return new Response(JSON.stringify({ error: "Session not found" }), { status: 404, headers: jsonHeaders });

    const ownerSub = await getOwnerSubscription(workspaceId);
    if (!ownerSub?.subscription) return new Response(JSON.stringify({ error: "NO_SUBSCRIPTION" }), { status: 402, headers: jsonHeaders });
    if (!isSubscriptionActive(ownerSub.subscription.status)) return new Response(JSON.stringify({ error: "NO_SUBSCRIPTION" }), { status: 402, headers: jsonHeaders });
    const balance = calculateCreditBalance(ownerSub.subscription);
    if (!balance.canUseCredits || balance.total <= 0) return new Response(JSON.stringify({ error: "NO_CREDITS" }), { status: 402, headers: jsonHeaders });

    await admin.from("image_classification_sessions").update({ status: "processing", error_message: null }).eq("id", sessionId);
    EdgeRuntime.waitUntil(runClassificationJob({ workspaceId, sessionId, images, instruction, thinkingLevel, userId: user.id, ownerSub }));
    return new Response(JSON.stringify({ status: "accepted", sessionId }), { status: 202, headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message || "Internal error" }), { status: 500, headers: jsonHeaders });
  }
});

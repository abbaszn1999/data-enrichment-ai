// Image Classification API — accepts the job immediately (202) and runs Gemini
// 3.6 Flash in the background on the long-lived Render/Node process.
// Pricing comes from the shared ai-pricing module (official rates, no margin).

import { after, NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
  updateCachedCredits,
} from "@/lib/workspace-context";
import { calculateCallCost, costToCredits } from "@/lib/ai-pricing";
import { sanitizeSku } from "@/lib/image-classify/sku";
import {
  getImageClassificationResultPath,
  type ImageClassificationJson,
  type ImageClassificationGroup,
  type ImageClassificationItem,
} from "@/lib/storage-helpers";
import { saveJsonToStorageServer } from "@/lib/storage-helpers-server";
import { mapLimit } from "@/lib/async/map-limit";
import { requireGeminiApiKey } from "@/lib/sync/agent/ai-utils";

export const maxDuration = 300;

const MODEL = "gemini-3.6-flash";
const MAX_IMAGES = 200;
const SIGNED_URL_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

type RequestImage = {
  id: string;
  filename: string;
  storagePath: string;
  mimeType?: string;
};

type RequestBody = {
  workspaceId?: string;
  sessionId?: string;
  images?: RequestImage[];
  instruction?: string;
  thinkingLevel?: string;
};

type GeminiGroup = {
  id: string;
  label: string;
  description?: string;
  imageIds: string[];
};

type GeminiResult = {
  groups: GeminiGroup[];
  items: Array<{
    id: string;
    groupId: string;
    sku?: string;
    confidence?: number;
    notes?: string;
  }>;
};

function buildSystemInstruction(): string {
  return [
    "You are a senior ecommerce product image classification specialist.",
    "Your job is to group images by the actual product being sold, not by brand alone, visual theme alone, color alone, or broad category alone.",
    "A group must contain images that plausibly represent the same product, the same product family, or intentionally equivalent variants according to the customer's instruction.",
    "Never group fundamentally different product types together. Shoes, sandals, bags, wallets, belts, hats, shirts, pants, shorts, dresses, cups, saucers, toys, and accessories must be separate unless the customer explicitly asks to group them together.",
    "When uncertain between merging and splitting, choose splitting. Over-splitting is better than mixing unrelated products.",
    "Every image MUST be assigned to exactly one group.",
    "Return JSON only, matching the provided schema. Do not invent image ids; use only the ids that appear in the user prompt.",
    "For each image, extract a real SKU/code from the filename ONLY when one clearly exists.",
    "A valid SKU looks like a product code (short alphanumeric, often with digits), for example: COSH261032-RAIN-11, HK5000030_584, cw637, SKU-88421.",
    "NEVER copy the whole filename or a human product title into sku. Names like Ecommerce-SEO-EBOOK, Technical-SEO-Mastery-for-eCom-Brands, The-AI-Commerce-Playbook are titles, not SKUs — leave sku as an empty string.",
    "If the customer's custom instruction explains where the SKU is in the filename, follow that instruction exactly.",
    "If no SKU/code can be identified with confidence, output an empty string for sku.",
    "CRITICAL RULE: If multiple images share the exact same non-empty SKU, they MUST be assigned to the same product group.",
  ].join(" ");
}

function buildUserPrompt(
  images: RequestImage[],
  instruction: string | undefined
): string {
  const lines: string[] = [];
  lines.push(
    `Classify the following ${images.length} ecommerce product images into accurate product groups.`
  );
  lines.push(
    "Primary goal: maximize precision and avoid false merges. Do not mix unrelated products in the same group."
  );
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
  lines.push("Image catalog (id → filename):");
  for (const img of images) {
    lines.push(`- ${img.id} → ${img.filename}`);
  }
  lines.push(
    "Each image is provided in order below this prompt as inlineData parts."
  );
  lines.push(
    "Output JSON with: groups[{id,label,description,imageIds[]}] and items[{id,groupId,sku,confidence,notes}]."
  );
  lines.push(
    "sku must be empty unless the filename contains a clear product code; never put the full title/filename into sku."
  );
  lines.push(
    "For each item, notes should briefly state the visual reason for its group assignment."
  );
  lines.push(
    "Before finalizing, audit every group and split any group that contains mixed product types or weak visual similarity."
  );
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
          id: {
            type: "string",
            description: "Stable group id created by the model, such as group_1.",
          },
          label: {
            type: "string",
            description:
              "Concise ecommerce product-group label focused on product type and distinguishing details, not brand alone.",
          },
          description: {
            type: "string",
            description:
              "Short explanation of why these images belong together and why they are separate from other groups.",
          },
          imageIds: {
            type: "array",
            description:
              "Image ids assigned to this precise product group. Do not include unrelated product types.",
            items: { type: "string" },
          },
        },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "groupId"],
        properties: {
          id: {
            type: "string",
            description: "The exact image id from the prompt.",
          },
          groupId: {
            type: "string",
            description:
              "The id of the precise product group this image belongs to.",
          },
          sku: {
            type: "string",
            description:
              "Short product SKU/code from the filename when clearly present. Empty string when the filename is a descriptive title or no SKU exists. Never return the full filename or a multi-word product title.",
          },
          confidence: {
            type: "number",
            description: "Confidence from 0 to 1 for this image's group assignment.",
          },
          notes: {
            type: "string",
            description:
              "Brief visual reason for the assignment, including product type and distinguishing details.",
          },
        },
      },
    },
  },
};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

async function downloadImage(
  admin: ReturnType<typeof createAdminClient>,
  storagePath: string
): Promise<{ data: string; mimeType: string } | null> {
  const { data, error } = await admin.storage
    .from("workspace-files")
    .download(storagePath);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return {
    data: arrayBufferToBase64(buf),
    mimeType: data.type || "image/jpeg",
  };
}

async function deductCreditsStrict(params: {
  ownerUserId: string;
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
  if (params.credits <= 0) return;
  const admin = createAdminClient();
  const { data: deductResult, error: deductError } = await admin.rpc(
    "deduct_user_credits",
    {
      p_user_id: params.ownerUserId,
      p_amount: params.credits,
      p_workspace_id: params.workspaceId,
      p_operation: "image_classification",
      p_uid: params.userId || params.ownerUserId,
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
    }
  );
  if (deductError) {
    throw new Error(`Credit deduction failed: ${deductError.message}`);
  }
  if (!deductResult?.success) {
    throw new Error(
      `Credit deduction rejected: ${deductResult?.error || "Insufficient credits"}`
    );
  }
  const remaining = Number(deductResult.remaining);
  if (Number.isFinite(remaining)) {
    updateCachedCredits(params.workspaceId, remaining);
  }
  console.log(
    `[image-classify] Deducted ${params.credits} credits. Remaining: ${deductResult.remaining}`
  );
}

async function runClassificationJob(params: {
  workspaceId: string;
  sessionId: string;
  images: RequestImage[];
  instruction?: string;
  thinkingLevel?: string;
  userId: string;
  ownerUserId: string;
}) {
  const admin = createAdminClient();
  const {
    workspaceId,
    sessionId,
    images,
    instruction,
    thinkingLevel,
    userId,
    ownerUserId,
  } = params;

  try {
    const downloads = await mapLimit(images, 6, (img) =>
      downloadImage(admin, img.storagePath)
    );
    const inlineParts: Array<{
      inlineData: { mimeType: string; data: string };
    }> = [];
    const validImages: RequestImage[] = [];
    downloads.forEach((d, i) => {
      if (d) {
        validImages.push(images[i]);
        inlineParts.push({
          inlineData: {
            mimeType: images[i].mimeType || d.mimeType || "image/jpeg",
            data: d.data,
          },
        });
      }
    });
    if (validImages.length === 0) {
      throw new Error("Failed to download any image from storage");
    }

    const apiKey = requireGeminiApiKey();
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const userPrompt = buildUserPrompt(validImages, instruction);

    const response = await (
      ai.models.generateContent as (p: unknown) => Promise<{
        text?: string;
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: unknown;
      }>
    )({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }, ...inlineParts],
        },
      ],
      config: {
        systemInstruction: buildSystemInstruction(),
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
        thinkingConfig: {
          thinkingLevel: thinkingLevel || "medium",
        },
      },
    });

    const rawText =
      response.text ??
      response.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("") ??
      "";
    if (!rawText) throw new Error("Empty response from model");

    let parsed: GeminiResult;
    try {
      parsed = JSON.parse(rawText) as GeminiResult;
    } catch (err) {
      throw new Error(
        `Failed to parse model output as JSON: ${(err as Error).message}`
      );
    }

    const cost = calculateCallCost(MODEL, response.usageMetadata, false);
    const credits = costToCredits(cost.totalCost);

    const groupsById = new Map<string, ImageClassificationGroup>();
    for (const g of parsed.groups || []) {
      if (!g?.id) continue;
      groupsById.set(g.id, {
        id: g.id,
        label: g.label,
        description: g.description,
        imageIds: Array.isArray(g.imageIds) ? g.imageIds : [],
      });
    }

    const itemByImageId = new Map<
      string,
      { groupId: string; sku?: string; confidence?: number; notes?: string }
    >();
    for (const it of parsed.items || []) {
      if (it && typeof it.id === "string") {
        itemByImageId.set(it.id, {
          groupId: it.groupId,
          sku: it.sku,
          confidence: it.confidence,
          notes: it.notes,
        });
      }
    }

    const urlByPath = new Map<string, string>();
    try {
      const paths = validImages.map((img) => img.storagePath);
      const { data: signed } = await admin.storage
        .from("workspace-files")
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      (signed ?? []).forEach((row, i) => {
        if (row?.signedUrl) urlByPath.set(paths[i], row.signedUrl);
      });
    } catch (err) {
      console.warn(
        "[image-classify] createSignedUrls failed:",
        (err as Error).message
      );
    }

    const items: ImageClassificationItem[] = [];
    for (const img of validImages) {
      const it = itemByImageId.get(img.id);
      let groupId = it?.groupId;
      if (!groupId || !groupsById.has(groupId)) {
        groupId = "unclassified";
        if (!groupsById.has(groupId)) {
          groupsById.set(groupId, {
            id: groupId,
            label: "Unclassified",
            description: "Images the model did not assign to a group",
            imageIds: [],
          });
        }
        const g = groupsById.get(groupId)!;
        if (!g.imageIds.includes(img.id)) g.imageIds.push(img.id);
      }
      const group = groupsById.get(groupId)!;
      items.push({
        id: img.id,
        filename: img.filename,
        storagePath: img.storagePath,
        url: urlByPath.get(img.storagePath) ?? "",
        groupId,
        groupLabel: group.label,
        sku: sanitizeSku(it?.sku, img.filename),
        confidence: it?.confidence,
        notes: it?.notes,
      });
    }

    const result: ImageClassificationJson = {
      sessionId,
      model: MODEL,
      thinkingLevel: thinkingLevel || "medium",
      createdAt: new Date().toISOString(),
      totalImages: validImages.length,
      groups: Array.from(groupsById.values()),
      items,
      usage: {
        promptTokens: cost.usage.promptTokens,
        candidatesTokens: cost.usage.candidatesTokens,
        totalTokens: cost.usage.totalTokens,
        totalCost: cost.totalCost,
        totalCredits: credits,
      },
    };

    await deductCreditsStrict({
      ownerUserId,
      credits,
      workspaceId,
      userId,
      sessionId,
      imageCount: validImages.length,
      groupCount: result.groups.length,
      totalCost: cost.totalCost,
      totalTokens: cost.usage.totalTokens,
      thinkingLevel,
    });

    const storagePath = getImageClassificationResultPath(workspaceId, sessionId);
    await saveJsonToStorageServer(storagePath, result);

    await admin
      .from("image_classification_sessions")
      .update({
        status: "completed",
        group_count: result.groups.length,
        storage_path: storagePath,
        total_cost: cost.totalCost,
        total_credits: credits,
        total_tokens: cost.usage.totalTokens,
        error_message: null,
      })
      .eq("id", sessionId);

    console.log(
      `[image-classify] Session ${sessionId} completed: ${result.groups.length} groups, ${credits} credits deducted`
    );
  } catch (err) {
    const message = (err as Error).message || "Classification failed";
    await admin
      .from("image_classification_sessions")
      .update({ status: "failed", error_message: message })
      .eq("id", sessionId);
    console.error("[image-classify] failed:", message);
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    workspaceId,
    sessionId,
    images = [],
    instruction,
    thinkingLevel,
  } = body;
  if (!workspaceId || !sessionId) {
    return NextResponse.json(
      { error: "Missing workspaceId or sessionId" },
      { status: 400 }
    );
  }
  if (!Array.isArray(images) || images.length === 0) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `Too many images (max ${MAX_IMAGES})` },
      { status: 400 }
    );
  }

  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  const headers: Record<string, string> = {
    "X-Context-Source": ctx.source,
    "Server-Timing": `ctx;dur=${ctx.durationMs.toFixed(1)}`,
  };

  if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
    return NextResponse.json(
      { error: "NO_SUBSCRIPTION" },
      { status: 402, headers }
    );
  }
  if ((ctx.credits?.total ?? 0) <= 0) {
    return NextResponse.json({ error: "NO_CREDITS" }, { status: 402, headers });
  }
  if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }

  const admin = createAdminClient();
  const { data: sessionRow, error: sessionErr } = await admin
    .from("image_classification_sessions")
    .select("id, workspace_id")
    .eq("id", sessionId)
    .single();
  if (sessionErr || !sessionRow || sessionRow.workspace_id !== workspaceId) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404, headers }
    );
  }

  await admin
    .from("image_classification_sessions")
    .update({ status: "processing", error_message: null })
    .eq("id", sessionId);

  const ownerUserId = ctx.subscription.user_id ?? ctx.ownerId ?? user.id;

  after(() =>
    runClassificationJob({
      workspaceId,
      sessionId,
      images,
      instruction,
      thinkingLevel,
      userId: user.id,
      ownerUserId,
    })
  );

  return NextResponse.json(
    { status: "accepted", sessionId },
    { status: 202, headers }
  );
}

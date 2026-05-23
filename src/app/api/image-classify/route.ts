// Image Classification API — sends ALL uploaded images to Gemini 3.5 Flash in
// a single multimodal request and returns a structured grouping JSON. Follows
// the same auth/subscription/credits pattern as /api/sync/agent.
//
// Request body:
//   {
//     workspaceId: string,
//     sessionId: string,            // pre-created image_classification_sessions row
//     images: Array<{ id, filename, storagePath, mimeType }>,
//     instruction?: string,
//   }
//
// Response: full ImageClassificationJson result (also persisted to storage).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  calculateCreditBalance,
  getOwnerSubscription,
  isSubscriptionActive,
} from "@/lib/stripe";
import {
  calculateCallCost,
  costToCredits,
} from "@/lib/ai-pricing";
import {
  getImageClassificationResultPath,
  type ImageClassificationJson,
  type ImageClassificationGroup,
  type ImageClassificationItem,
} from "@/lib/storage-helpers";
import { saveJsonToStorageServer } from "@/lib/storage-helpers-server";
import { requireGeminiApiKey } from "@/lib/sync/agent/ai-utils";

export const maxDuration = 300;

const MODEL = "gemini-3.5-flash";
const MAX_IMAGES = 200; // generous safety cap; Gemini supports up to 3,600

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
    "Output JSON with: groups[{id,label,description,imageIds[]}] and items[{id,groupId,confidence,notes}]."
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
            description: "Concise ecommerce product-group label focused on product type and distinguishing details, not brand alone.",
          },
          description: {
            type: "string",
            description: "Short explanation of why these images belong together and why they are separate from other groups.",
          },
          imageIds: {
            type: "array",
            description: "Image ids assigned to this precise product group. Do not include unrelated product types.",
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
            description: "The id of the precise product group this image belongs to.",
          },
          confidence: {
            type: "number",
            description: "Confidence from 0 to 1 for this image's group assignment.",
          },
          notes: {
            type: "string",
            description: "Brief visual reason for the assignment, including product type and distinguishing details.",
          },
        },
      },
    },
  },
};

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // Node Buffer is available in Next API routes
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

  const { workspaceId, sessionId, images = [], instruction, thinkingLevel } = body;
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

  // Subscription + credits gate (mirrors /api/sync/agent)
  const ownerSub = await getOwnerSubscription(workspaceId);
  if (!ownerSub || !ownerSub.subscription) {
    return NextResponse.json({ error: "NO_SUBSCRIPTION" }, { status: 402 });
  }
  if (!isSubscriptionActive(ownerSub.subscription.status)) {
    return NextResponse.json({ error: "NO_SUBSCRIPTION" }, { status: 402 });
  }
  const balance = calculateCreditBalance(ownerSub.subscription);
  if (balance.total <= 0) {
    return NextResponse.json({ error: "NO_CREDITS" }, { status: 402 });
  }

  // Workspace membership
  const admin = createAdminClient();
  const { data: member, error: memberErr } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();
  if (memberErr || !member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (member.role === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify session exists and belongs to workspace
  const { data: sessionRow, error: sessionErr } = await admin
    .from("image_classification_sessions")
    .select("id, workspace_id")
    .eq("id", sessionId)
    .single();
  if (sessionErr || !sessionRow || sessionRow.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Mark processing
  await admin
    .from("image_classification_sessions")
    .update({ status: "processing" })
    .eq("id", sessionId);

  try {
    // Download every image from Storage and turn it into inlineData
    const downloads = await Promise.all(
      images.map((img) => downloadImage(admin, img.storagePath))
    );
    const inlineParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
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

    // Single multimodal request with ALL images. No batching by design — we
    // rely on Gemini 3.5 Flash's 1M-token context to retain cross-image
    // context for accurate grouping.
    const response = await (ai.models.generateContent as (p: unknown) => Promise<{
      text?: string;
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: unknown;
    }>)({
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

    // Cost / credits
    const cost = calculateCallCost(MODEL, response.usageMetadata, false);
    const credits = costToCredits(cost.totalCost);

    // Build the canonical result JSON. Use the model's groupings but
    // back-fill any image the model forgot, into an "unclassified" group.
    const groupsById = new Map<string, ImageClassificationGroup>();
    for (const g of parsed.groups || []) {
      groupsById.set(g.id, {
        id: g.id,
        label: g.label,
        description: g.description,
        imageIds: Array.isArray(g.imageIds) ? g.imageIds : [],
      });
    }

    const itemByImageId = new Map<
      string,
      { groupId: string; confidence?: number; notes?: string }
    >();
    for (const it of parsed.items || []) {
      if (it && typeof it.id === "string") {
        itemByImageId.set(it.id, {
          groupId: it.groupId,
          confidence: it.confidence,
          notes: it.notes,
        });
      }
    }

    // Generate long-lived signed URLs in a single batch so the exported
    // sheet has ready-to-use external links. 10y is well within the limit
    // documented by Supabase staff in discussion #7626 and avoids hitting
    // the storage API on every export.
    const SIGNED_URL_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;
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

    // Deduct credits (best-effort; never fail the response on this)
    if (credits > 0) {
      try {
        await admin.rpc("deduct_user_credits", {
          p_user_id: ownerSub.subscription.user_id,
          p_amount: credits,
          p_workspace_id: workspaceId,
          p_operation: "image_classification",
          p_uid: user.id,
          p_entity_type: "image_classification_session",
          p_entity_id: sessionId,
          p_details: {
            model: MODEL,
            imageCount: validImages.length,
            groupCount: result.groups.length,
          },
        });
      } catch (err) {
        console.warn(
          "[image-classify] credit deduction failed:",
          (err as Error).message
        );
      }
    }

    return NextResponse.json({ result });
  } catch (err) {
    const message = (err as Error).message || "Classification failed";
    await admin
      .from("image_classification_sessions")
      .update({ status: "failed", error_message: message })
      .eq("id", sessionId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

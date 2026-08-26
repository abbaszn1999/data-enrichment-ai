import { z } from "zod";
import { NextResponse } from "next/server";

export const workspaceIdSchema = z.string().uuid();
export const projectIdSchema = z.string().uuid();

export const wrChatMessageSchema = z.object({
  id: z.string().max(80),
  role: z.enum(["agent", "user"]),
  text: z.string().max(4000),
  isError: z.boolean().optional(),
});

export const wrUploadedImageSchema = z.object({
  id: z.string().max(80),
  storagePath: z.string().max(400),
  filename: z.string().max(200),
});

export const wrCompetitorInputSchema = z.object({ raw: z.string().min(1).max(300) });

export const wrStateSchema = z.object({
  chat: z.array(wrChatMessageSchema).max(60),
  images: z.array(wrUploadedImageSchema).max(10),
  logo: wrUploadedImageSchema.nullable(),
  competitors: z.array(wrCompetitorInputSchema).max(4),
  competitorsSkipped: z.boolean().optional(),
});

export const createProjectBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(120),
});

export const projectRefBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
});

export const patchProjectBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  name: z.string().min(1).max(120).optional(),
  status: z.enum(["active", "completed"]).optional(),
  phase: z.enum(["awaiting_images", "awaiting_logo", "awaiting_competitors"]).optional(),
});

export const putStateBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  state: wrStateSchema,
});

const MAX_UPLOAD_BASE64_CHARS = 11_000_000; // ~8MB decoded, generous for a full-page screenshot

export const assetUploadBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  kind: z.enum(["image", "logo"]),
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  dataBase64: z.string().min(1).max(MAX_UPLOAD_BASE64_CHARS),
});

export const assetDeleteBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  kind: z.enum(["image", "logo"]),
  imageId: z.string().max(80).optional(),
});

export const buildBodySchema = projectRefBodySchema.extend({
  storeLanguageHint: z.string().max(60).optional(),
});

export const chatEditBodySchema = projectRefBodySchema.extend({
  instruction: z.string().min(1).max(2000),
});

export const restoreVersionBodySchema = projectRefBodySchema.extend({
  version: z.number().int().positive(),
});

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

import { z } from "zod";

/**
 * Wire protocol shared by the browser, the Next.js gateway and the assistant
 * service. Every event that reaches the browser is one of `assistantEventSchema`;
 * nothing about the model, the SDK or internal tool names is part of it.
 */

export const ASSISTANT_LIMITS = {
  /** Browser actions one run may perform. */
  maxActionsPerRun: 40,
  /** Wall-clock time of one run. */
  maxRunMs: 10 * 60 * 1000,
  /** How long a browser action may take to answer. */
  actionTimeoutMs: 30 * 1000,
  /** How long a confirmation may wait for the user. */
  confirmationTimeoutMs: 5 * 60 * 1000,
  maxMessageChars: 4000,
  maxSnapshotChars: 12000,
} as const;

/** Interactive element ids come from `data-agent-id` attributes. */
export const agentTargetSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/i, "Invalid target id");

export const browserActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("see_page") }),
  z.object({
    kind: z.literal("click"),
    target: agentTargetSchema,
    /** Required when the element spends credits; issued by the confirmation card. */
    approvalToken: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal("type"), target: agentTargetSchema, text: z.string().max(2000) }),
  z.object({ kind: z.literal("navigate"), path: z.string().max(300) }),
  z.object({ kind: z.literal("upload_file"), target: agentTargetSchema, fileId: z.string().max(120) }),
  z.object({
    kind: z.literal("wait_for"),
    target: agentTargetSchema.optional(),
    ms: z.number().int().min(100).max(15000).optional(),
  }),
  z.object({ kind: z.literal("ci_get_state") }),
  z.object({
    kind: z.literal("ci_select_rows"),
    mode: z.enum(["all", "none", "indexes", "empty_columns"]),
    indexes: z.array(z.number().int().min(1)).max(500).optional(),
    columns: z.array(z.string().max(120)).max(30).optional(),
  }),
  z.object({
    kind: z.literal("ci_set_columns"),
    enable: z.array(z.string().max(120)).max(40).optional(),
    disable: z.array(z.string().max(120)).max(40).optional(),
  }),
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;

export const assistantEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run"), runId: z.string(), conversationId: z.string().optional() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("step"), label: z.string().max(200) }),
  /** Live reasoning, streamed in small pieces. */
  z.object({ type: z.literal("thinking"), text: z.string().max(4000) }),
  /** The current reasoning block ended. */
  z.object({ type: z.literal("thinking_end"), durationMs: z.number().min(0).optional() }),
  /** One tool step, sent when it starts and again when it ends (same id). */
  z.object({
    type: z.literal("tool"),
    id: z.string().max(120),
    status: z.enum(["running", "completed", "error"]),
    kind: z.enum(["code", "page", "action", "sheet", "approval"]),
    title: z.string().max(120),
    detail: z.string().max(300).optional(),
    summary: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal("browser_action"), callId: z.string(), action: browserActionSchema }),
  z.object({
    type: z.literal("confirmation"),
    callId: z.string(),
    title: z.string().max(200),
    details: z.array(z.string().max(300)).max(8),
    /** The element id the approval unlocks. */
    actionTarget: agentTargetSchema,
    estimateCredits: z.object({ min: z.number().min(0), max: z.number().min(0) }).optional(),
  }),
  z.object({
    type: z.literal("done"),
    status: z.enum(["finished", "cancelled", "error"]),
    credits: z.number().min(0).optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("ping") }),
]);
export type AssistantEvent = z.infer<typeof assistantEventSchema>;

/** Page context sent with every message. */
export const pageContextSchema = z.object({
  workspaceSlug: z.string().max(120),
  workspaceId: z.string().max(80),
  path: z.string().max(300),
  sessionId: z.string().max(80).optional(),
});
export type PageContext = z.infer<typeof pageContextSchema>;

/** A file the user attached in the widget. The bytes stay in the browser. */
export const attachedFileSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().max(200),
});
export type AttachedFile = z.infer<typeof attachedFileSchema>;

export const chatRequestSchema = z.object({
  message: z.string().min(1).max(ASSISTANT_LIMITS.maxMessageChars),
  context: pageContextSchema,
  /** Conversation to continue; omitted for a new one. */
  conversationId: z.string().max(80).optional(),
  files: z.array(attachedFileSchema).max(5).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const toolResultSchema = z.object({
  runId: z.string().max(80),
  callId: z.string().max(80),
  ok: z.boolean(),
  /** Free-form JSON result, capped before it reaches the model. */
  result: z.unknown().optional(),
  error: z.string().max(1000).optional(),
});
export type ToolResult = z.infer<typeof toolResultSchema>;

/** Body the gateway signs and sends to the service to start a run. */
export const serviceRunRequestSchema = z.object({
  runId: z.string().max(80),
  userId: z.string().max(80),
  workspaceId: z.string().max(80),
  message: z.string().min(1).max(ASSISTANT_LIMITS.maxMessageChars),
  context: pageContextSchema,
  conversationId: z.string().max(80).optional(),
  files: z.array(attachedFileSchema).max(5).optional(),
});
export type ServiceRunRequest = z.infer<typeof serviceRunRequestSchema>;

/** Only same-workspace paths are navigable. */
export function isAllowedNavigation(path: string, workspaceSlug: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.includes("\\") || path.includes("..")) return false;
  const base = `/w/${workspaceSlug}`;
  return path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`);
}

/** Admin and billing surfaces the assistant never opens. */
const BLOCKED_SEGMENTS = ["/platform-admin", "/billing", "/settings/billing", "/team"];
export function isBlockedNavigation(path: string): boolean {
  return BLOCKED_SEGMENTS.some((segment) => path.includes(segment));
}

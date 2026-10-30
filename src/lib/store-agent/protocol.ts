// Contract between the Next.js gateway (/api/store-agent/*) and the Store
// Agent service (assistant-service/src/store-agent). Imported by both, so it
// uses relative-safe imports only.

import { z } from "zod";

export const STORE_AGENT_LIMITS = {
  maxMessageChars: 20_000,
  maxAttachments: 10,
  maxImageBytes: 10 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024,
  /** A run that is still going after this is stopped. */
  maxRunMs: 60 * 60 * 1000,
  /** An approval or question nobody answers expires after this. */
  maxWaitMs: 30 * 60 * 1000,
  /** Runs at once per workspace. */
  maxConcurrentRunsPerWorkspace: 2,
  /** Credits a run needs available before it starts. */
  minCreditsToStart: 0.5,
} as const;

export const modelParamSchema = z.object({ id: z.string().min(1).max(40), value: z.string().max(40) });
export type ModelParam = z.infer<typeof modelParamSchema>;

export const attachmentRefSchema = z.object({
  /** store_agent_files.id of an upload the gateway already stored. */
  fileId: z.string().uuid(),
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  size: z.number().int().nonnegative(),
  storagePath: z.string().min(1).max(500),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

/** Gateway → service: start a run in a chat. */
export const startRunSchema = z.object({
  runId: z.string().uuid(),
  chatId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  message: z.string().max(STORE_AGENT_LIMITS.maxMessageChars),
  attachments: z.array(attachmentRefSchema).max(STORE_AGENT_LIMITS.maxAttachments).default([]),
  model: z.object({ id: z.string().min(1).max(80), params: z.array(modelParamSchema).max(10) }),
  mode: z.enum(["agent", "plan"]),
  autoRun: z.boolean(),
  /** Auto-run also covers bulk changes: only for the workspace owner or an admin, who may approve them. */
  autoRunBulk: z.boolean().default(false),
  /** The subscription owner who pays, and what they have left. */
  billing: z.object({ ownerUserId: z.string().uuid(), remainingCredits: z.number().nonnegative() }),
  locale: z.string().max(20).optional(),
  /** Build this plan (store_agent_plans.id): an Agent-mode run that carries it out. */
  buildPlanId: z.string().uuid().optional(),
});
export type StartRunRequest = z.infer<typeof startRunSchema>;

export const decisionSchema = z.object({
  runId: z.string().uuid(),
  approvalId: z.string().uuid(),
  approve: z.boolean(),
});

/** Most questions one card can hold (the agent decides how many it needs). */
export const MAX_QUESTIONS_PER_CARD = 8;

/** The answers to one question card: per question, in order, the options picked or the text typed. */
export const questionAnswersSchema = z
  .array(z.array(z.string().max(2000)).max(20))
  .min(1)
  .max(MAX_QUESTIONS_PER_CARD);

export const answerSchema = z.object({
  runId: z.string().uuid(),
  questionId: z.string().min(1).max(80),
  answers: questionAnswersSchema,
});

export const steerSchema = z.object({ runId: z.string().uuid(), text: z.string().min(1).max(4000) });
export const cancelSchema = z.object({ runId: z.string().uuid() });

// ─── Events streamed to the browser (NDJSON, one per line) ───────────────────

export type ToolKind = "store_read" | "store_write" | "web" | "image" | "file" | "plan" | "think" | "agent" | "other";

/** A page a web search found or a web page the agent read. */
export type ToolLink = { title: string; url: string };

export type TodoItem = { id: string; content: string; status: "pending" | "in_progress" | "completed" | "cancelled" };

/** One question on a question card. */
export type QuestionItem = { id: string; text: string; options: string[]; multiple: boolean };

export type PlanStatus = "draft" | "building" | "built";

export type ApprovalPreview = {
  /** One line per affected record: what changes, before → after when known. */
  items: Array<{ id: string; label: string; changes: Array<{ field: string; before?: string; after?: string }> }>;
  /** Records affected beyond the items shown. */
  more: number;
};

export type StoreAgentEvent =
  | { type: "run"; runId: string; chatId: string; seq: number }
  | { type: "text"; delta: string; seq: number }
  /** A message the user sent while the run was working. */
  | { type: "guidance"; text: string; seq: number }
  | { type: "thinking"; delta: string; seq: number }
  | { type: "thinking_done"; ms: number; seq: number }
  | {
      type: "tool_start";
      callId: string;
      tool: string;
      kind: ToolKind;
      title: string;
      detail?: string;
      /** Found after it ran (web calls): shown before the text being written, not inside it. */
      late?: boolean;
      seq: number;
    }
  | { type: "tool_end"; callId: string; ok: boolean; summary?: string; links?: ToolLink[]; seq: number }
  | { type: "todos"; items: TodoItem[]; seq: number }
  | {
      type: "approval";
      approvalId: string;
      risk: "write" | "delete" | "bulk";
      summary: string;
      operations: string[];
      preview: ApprovalPreview | null;
      /** Full before → after table, opened in the panel, for larger changes. */
      previewFileId?: string;
      /** Records the change touches. */
      records?: number;
      seq: number;
    }
  | {
      type: "approval_resolved";
      approvalId: string;
      status: "approved" | "rejected" | "expired";
      /** Applied without asking (Auto-run). */
      auto?: boolean;
      /** A backup was kept: the change can be undone. */
      undoable?: boolean;
      seq: number;
    }
  /** Live activity while the run works: output tokens so far and tool calls. */
  | { type: "progress"; outputTokens: number; toolCalls: number; seq: number }
  /** One card with one or more questions, each with options (and a free answer). */
  | { type: "question"; questionId: string; questions: QuestionItem[]; seq: number }
  | { type: "question_resolved"; questionId: string; answers: string[][]; seq: number }
  /** A plan written in Plan mode, or a new version of it, or its build status changing. */
  | { type: "plan"; planId: string; title: string; content: string; version: number; status: PlanStatus; seq: number }
  | { type: "file"; fileId: string; name: string; kind: string; mime: string; open: boolean; seq: number }
  | { type: "summary"; status: "started" | "completed"; seq: number }
  | { type: "context"; usedTokens: number; windowTokens: number; seq: number }
  | { type: "usage"; credits: number; usd: number; seq: number }
  | { type: "error"; message: string; seq: number }
  | { type: "done"; status: "finished" | "cancelled" | "error" | "interrupted"; credits: number; seq: number }
  | { type: "ping"; seq: number };

export type StoreAgentEventType = StoreAgentEvent["type"];

/** Events with the seq left to the emitter. */
export type StoreAgentEventInput = StoreAgentEvent extends infer E ? (E extends StoreAgentEvent ? Omit<E, "seq"> : never) : never;

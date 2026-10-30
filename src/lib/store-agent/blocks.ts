// One assistant reply as an ordered list of blocks, built from the event
// stream. The service uses it to save the reply; the page uses the same
// reducer to render it live, so a reloaded chat looks exactly like it did.

import type { ApprovalPreview, QuestionItem, StoreAgentEvent, TodoItem, ToolKind, ToolLink } from "./protocol";

export type MessageBlock =
  | { type: "text"; text: string }
  /** What the user wrote while the reply was being worked on, where it arrived. */
  | { type: "guidance"; text: string }
  | { type: "thinking"; text: string; ms?: number; done: boolean }
  | {
      type: "tool";
      callId: string;
      tool: string;
      kind: ToolKind;
      title: string;
      detail?: string;
      status: "running" | "ok" | "error";
      summary?: string;
      links?: ToolLink[];
    }
  | { type: "todos"; items: TodoItem[] }
  | {
      type: "approval";
      approvalId: string;
      risk: "write" | "delete" | "bulk";
      summary: string;
      operations: string[];
      preview: ApprovalPreview | null;
      previewFileId?: string;
      records?: number;
      status: "pending" | "approved" | "rejected" | "expired";
      auto?: boolean;
      undoable?: boolean;
    }
  | { type: "question"; questionId: string; questions: QuestionItem[]; answers?: string[][] }
  /** The plan this reply wrote or revised; its text lives with the plan, shown in the panel. */
  | { type: "plan"; planId: string; title: string; version: number }
  | { type: "file"; fileId: string; name: string; kind: string; mime: string }
  | { type: "summary"; status: "started" | "completed" }
  | { type: "error"; message: string };

export type ReplyState = {
  blocks: MessageBlock[];
  status: "running" | "finished" | "cancelled" | "error" | "interrupted";
  credits: number;
  context?: { usedTokens: number; windowTokens: number };
  progress?: { outputTokens: number; toolCalls: number };
  lastSeq: number;
};

export const emptyReply = (): ReplyState => ({ blocks: [], status: "running", credits: 0, lastSeq: 0 });

/** Apply one event. Pure: returns a new state, never mutates the old one. */
export function reduceReply(state: ReplyState, event: StoreAgentEvent): ReplyState {
  if (event.seq <= state.lastSeq) return state;
  const next: ReplyState = { ...state, lastSeq: event.seq };
  const blocks = [...state.blocks];
  const last = blocks[blocks.length - 1];

  switch (event.type) {
    case "text":
      if (last?.type === "text") blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
      else blocks.push({ type: "text", text: event.delta });
      break;
    case "guidance":
      blocks.push({ type: "guidance", text: event.text });
      break;
    case "thinking":
      if (last?.type === "thinking" && !last.done) blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
      else blocks.push({ type: "thinking", text: event.delta, done: false });
      break;
    case "thinking_done": {
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i]!;
        if (b.type === "thinking" && !b.done) {
          blocks[i] = { ...b, done: true, ms: event.ms };
          break;
        }
      }
      break;
    }
    case "tool_start":
      blocks.push({
        type: "tool",
        callId: event.callId,
        tool: event.tool,
        kind: event.kind,
        title: event.title,
        detail: event.detail,
        status: "running",
      });
      break;
    case "tool_end": {
      const i = blocks.findIndex((b) => b.type === "tool" && b.callId === event.callId);
      if (i >= 0) {
        const b = blocks[i] as Extract<MessageBlock, { type: "tool" }>;
        // A web call can end twice (onDelta, then its links read back): keep what the first one said.
        blocks[i] = {
          ...b,
          status: event.ok ? "ok" : "error",
          summary: event.summary ?? b.summary,
          ...(event.links?.length ? { links: event.links } : {}),
        };
      }
      break;
    }
    case "todos": {
      // One live todo list per reply: the latest replaces the earlier one in place.
      const i = blocks.findIndex((b) => b.type === "todos");
      if (i >= 0) blocks[i] = { type: "todos", items: event.items };
      else blocks.push({ type: "todos", items: event.items });
      break;
    }
    case "approval":
      blocks.push({
        type: "approval",
        approvalId: event.approvalId,
        risk: event.risk,
        summary: event.summary,
        operations: event.operations,
        preview: event.preview,
        previewFileId: event.previewFileId,
        records: event.records,
        status: "pending",
      });
      break;
    case "approval_resolved": {
      const i = blocks.findIndex((b) => b.type === "approval" && b.approvalId === event.approvalId);
      if (i >= 0) {
        blocks[i] = {
          ...(blocks[i] as Extract<MessageBlock, { type: "approval" }>),
          status: event.status,
          auto: event.auto,
          undoable: event.undoable,
        };
      }
      break;
    }
    case "progress":
      next.progress = { outputTokens: event.outputTokens, toolCalls: event.toolCalls };
      break;
    case "question":
      blocks.push({ type: "question", questionId: event.questionId, questions: event.questions });
      break;
    case "question_resolved": {
      const i = blocks.findIndex((b) => b.type === "question" && b.questionId === event.questionId);
      if (i >= 0) blocks[i] = { ...(blocks[i] as Extract<MessageBlock, { type: "question" }>), answers: event.answers };
      break;
    }
    case "plan": {
      // A revision in the same reply updates its card rather than adding another.
      const i = blocks.findIndex((b) => b.type === "plan" && b.planId === event.planId);
      const block = { type: "plan" as const, planId: event.planId, title: event.title, version: event.version };
      if (i >= 0) blocks[i] = block;
      else blocks.push(block);
      break;
    }
    case "file":
      if (!blocks.some((b) => b.type === "file" && b.fileId === event.fileId)) {
        blocks.push({ type: "file", fileId: event.fileId, name: event.name, kind: event.kind, mime: event.mime });
      }
      break;
    case "summary":
      if (event.status === "started") blocks.push({ type: "summary", status: "started" });
      else {
        const i = blocks.map((b) => b.type).lastIndexOf("summary");
        if (i >= 0) blocks[i] = { type: "summary", status: "completed" };
      }
      break;
    case "context":
      next.context = { usedTokens: event.usedTokens, windowTokens: event.windowTokens };
      break;
    case "usage":
      next.credits = event.credits;
      break;
    case "error":
      blocks.push({ type: "error", message: event.message });
      break;
    case "done":
      next.status = event.status;
      next.credits = event.credits;
      // Anything still marked running did not finish.
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]!;
        if (b.type === "tool" && b.status === "running") blocks[i] = { ...b, status: "error", summary: b.summary ?? "stopped" };
        if (b.type === "thinking" && !b.done) blocks[i] = { ...b, done: true };
        if (b.type === "approval" && b.status === "pending") blocks[i] = { ...b, status: "expired" };
      }
      break;
    case "run":
    case "ping":
      break;
  }
  next.blocks = blocks;
  return next;
}

/** A question block in either shape: one card of questions, or the single question saved by earlier versions. */
export function questionCard(block: Extract<MessageBlock, { type: "question" }>): { questions: QuestionItem[]; answers?: string[][] } {
  if (Array.isArray(block.questions)) return { questions: block.questions, answers: block.answers };
  const legacy = block as unknown as { text: string; options: string[]; multiple: boolean; answers?: string[] };
  return {
    questions: [{ id: "q1", text: legacy.text, options: legacy.options ?? [], multiple: !!legacy.multiple }],
    answers: legacy.answers ? [legacy.answers] : undefined,
  };
}

/** The reply's plain text, for titles, search and the conversation summary. */
export function replyText(blocks: readonly MessageBlock[]): string {
  return blocks
    .filter((b): b is Extract<MessageBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

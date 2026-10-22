import type { AssistantEvent } from "../../../src/lib/assistant/protocol";

/** The subset of SDK stream messages the mapper reads. Everything else is dropped. */
export type SdkStreamMessage =
  | { type: "assistant"; message: { content: Array<{ type: string; text?: string }> } }
  | { type: "thinking"; text: string; thinking_duration_ms?: number }
  | { type: "tool_call"; call_id: string; name: string; status: "running" | "completed" | "error"; args?: unknown; result?: unknown }
  | { type: string; [key: string]: unknown };

type ToolEvent = Extract<AssistantEvent, { type: "tool" }>;
type Args = Record<string, unknown>;

/** Internal plumbing names that must never reach the user. */
const INTERNAL_NAMES = /\b(GetDynamicTools|CallDynamicTool|custom-user-tools|providerIdentifier|mcp)\b/gi;

export function scrubInternal(text: string): string {
  return text.replace(INTERNAL_NAMES, "tool");
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** `ci.new.session-name` -> `session name`. */
function controlName(id: unknown): string {
  const last = str(id).split(".").pop() ?? "";
  return last.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
}

/** Last two path segments, enough to recognise a file without exposing the tree. */
function shortPath(path: unknown): string {
  const parts = str(path).split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join("/") || "platform";
}

function pagePath(path: unknown): string {
  return str(path).replace(/^\/w\/[^/]+/, "") || "/";
}

function describe(toolName: string, args: Args): Pick<ToolEvent, "kind" | "title" | "detail"> {
  switch (toolName) {
    case "search_code":
      return { kind: "code", title: "Searching the platform", detail: clip(`"${str(args.pattern ?? args.query)}"`, 80) };
    case "read_file":
      return { kind: "code", title: "Reading", detail: shortPath(args.path) };
    case "list_dir":
      return { kind: "code", title: "Browsing", detail: shortPath(args.path) };
    case "see_page":
      return { kind: "page", title: "Looking at the page" };
    case "wait_for":
      return { kind: "page", title: "Waiting for the page", detail: args.target ? controlName(args.target) : undefined };
    case "navigate":
      return { kind: "page", title: "Opening", detail: pagePath(args.path) };
    case "click":
      return { kind: "action", title: "Clicking", detail: controlName(args.target) };
    case "type":
      return { kind: "action", title: "Typing", detail: `${clip(`"${str(args.text)}"`, 50)} → ${controlName(args.target)}` };
    case "upload_file":
      return Array.isArray(args.fileIds) && args.fileIds.length > 1
        ? { kind: "action", title: "Uploading the files", detail: `${args.fileIds.length} files` }
        : { kind: "action", title: "Uploading the file" };
    case "list_projects":
      return { kind: "page", title: "Finding your projects", detail: args.tool ? str(args.tool) : undefined };
    case "ci_get_state":
      return { kind: "sheet", title: "Reading the sheet" };
    case "ci_select_rows": {
      const mode = str(args.mode);
      const detail =
        mode === "indexes" && Array.isArray(args.indexes)
          ? `rows ${clip(args.indexes.join(", "), 60)}`
          : mode === "empty_columns" && Array.isArray(args.columns)
            ? `empty ${clip(args.columns.join(", "), 60)}`
            : mode;
      return { kind: "sheet", title: "Selecting rows", detail };
    }
    case "ci_set_columns": {
      const on = Array.isArray(args.enable) ? args.enable.map(String) : [];
      const off = Array.isArray(args.disable) ? args.disable.map(String) : [];
      const detail = [on.length ? `on: ${on.join(", ")}` : "", off.length ? `off: ${off.join(", ")}` : ""].filter(Boolean).join(" · ");
      return { kind: "sheet", title: "Choosing columns", detail: clip(detail, 120) || undefined };
    }
    case "gallery_get_state":
      return { kind: "sheet", title: "Reading the gallery" };
    case "visualizer_get_state":
      return { kind: "sheet", title: "Reading the visualizer" };
    case "classify_get_state":
      return { kind: "sheet", title: "Reading the classification" };
    case "website_get_state":
      return { kind: "sheet", title: "Reading the header project" };
    case "store_get_state":
      return { kind: "sheet", title: "Reading the Store Assistant" };
    case "visualizer_set_columns":
      return {
        kind: "sheet",
        title: "Choosing columns",
        detail: Array.isArray(args.columns) ? clip(args.columns.join(", "), 80) : undefined,
      };
    case "gallery_select_rows":
    case "visualizer_select_rows": {
      const mode = str(args.mode);
      const detail =
        mode === "indexes" && Array.isArray(args.indexes)
          ? `rows ${clip(args.indexes.join(", "), 60)}`
          : mode === "status" && Array.isArray(args.statuses)
            ? clip(args.statuses.join(", "), 60)
            : mode;
      return { kind: "sheet", title: "Selecting products", detail };
    }
    case "ask_confirmation":
      return { kind: "approval", title: "Asking for your approval", detail: clip(str(args.title), 100) };
    default:
      return { kind: "action", title: "Working" };
  }
}

/** Text of a tool result as the SDK reports it: `{ status, value: { content: [{ text: { text } }], isError } }`. */
function resultText(result: unknown): { text: string; isError: boolean } {
  const value = (result as { value?: { content?: unknown[]; isError?: boolean } } | undefined)?.value;
  const first = value?.content?.[0] as { text?: { text?: string } | string } | undefined;
  const text = typeof first?.text === "string" ? first.text : (first?.text?.text ?? "");
  return { text, isError: value?.isError === true || (result as { status?: string } | undefined)?.status === "error" };
}

function summarize(toolName: string, text: string): string | undefined {
  if (!text) return undefined;
  switch (toolName) {
    case "search_code": {
      if (/^no matches/i.test(text)) return "no matches";
      const count = text.split("\n").filter((line) => /:\d+:/.test(line)).length;
      return count ? `${count} match${count === 1 ? "" : "es"}` : undefined;
    }
    case "read_file": {
      const lines = text.split("\n").filter((line) => /^\s*\d+[|:]/.test(line)).length;
      return lines ? `${lines} lines` : undefined;
    }
    case "see_page": {
      try {
        const page = JSON.parse(text) as { controls?: unknown[]; heading?: string };
        const parts = [page.heading ? clip(page.heading, 60) : "", Array.isArray(page.controls) ? `${page.controls.length} controls` : ""];
        return parts.filter(Boolean).join(" · ") || undefined;
      } catch {
        return undefined;
      }
    }
    case "list_projects": {
      try {
        const lists = Object.values(JSON.parse(text) as Record<string, { projects?: unknown[] }>);
        const count = lists.reduce((total, list) => total + (Array.isArray(list?.projects) ? list.projects.length : 0), 0);
        return `${count} project${count === 1 ? "" : "s"}`;
      } catch {
        return undefined;
      }
    }
    case "ask_confirmation":
      return /"approved"\s*:\s*true/.test(text) ? "approved" : "declined";
    case "list_dir":
      return `${text.split("\n").filter(Boolean).length} items`;
    default:
      return clip(text.replace(/\s+/g, " "), 100);
  }
}

/**
 * Convert one SDK message into zero or more public events. Model names, raw
 * tool plumbing and full tool results never leave this function.
 */
/**
 * One token of assistant text. The SDK then repeats the same chunk as an
 * `assistant` stream message, so callers that use this must not also emit that message.
 */
export function mapTextDelta(update: { type: string; text?: unknown }): AssistantEvent | null {
  if (update.type !== "text-delta" || typeof update.text !== "string" || update.text.length === 0) return null;
  return { type: "text", text: scrubInternal(update.text) };
}

export function mapSdkMessage(message: SdkStreamMessage, options?: { assistantText?: boolean }): AssistantEvent[] {
  if (message.type === "assistant") {
    if (options?.assistantText === false) return [];
    const content = (message as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content ?? [];
    return content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => ({ type: "text" as const, text: scrubInternal(block.text as string) }));
  }

  if (message.type === "thinking") {
    const thinking = message as { text?: string; thinking_duration_ms?: number };
    if (thinking.text) return [{ type: "thinking", text: scrubInternal(thinking.text).slice(0, 4000) }];
    if (typeof thinking.thinking_duration_ms === "number") {
      return [{ type: "thinking_end", durationMs: thinking.thinking_duration_ms }];
    }
    return [];
  }

  if (message.type === "tool_call") {
    const call = message as { call_id?: string; status?: string; args?: { toolName?: string; args?: Args }; result?: unknown };
    const toolName = call.args?.toolName;
    if (!call.call_id || typeof toolName !== "string") return [];
    const base = describe(toolName, call.args?.args ?? {});
    if (call.status === "running") {
      return [{ type: "tool", id: call.call_id, status: "running", ...base }];
    }
    const { text, isError } = resultText(call.result);
    const failed = call.status === "error" || isError;
    const summary = failed ? clip(scrubInternal(text || "failed").replace(/\s+/g, " "), 140) : summarize(toolName, text);
    return [{ type: "tool", id: call.call_id, status: failed ? "error" : "completed", ...base, ...(summary ? { summary } : {}) }];
  }

  return [];
}

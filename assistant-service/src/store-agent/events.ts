import { Kind, parse, type OperationDefinitionNode } from "graphql";
import type { StoreAgentEventInput, TodoItem, ToolKind } from "../../../src/lib/store-agent/protocol";

type Args = Record<string, unknown>;
type Described = { kind: ToolKind; title: string; detail?: string };

/** Internal plumbing names that must never reach the user. */
const INTERNAL = /\b(GetDynamicTools|CallDynamicTool|GetMcpTools|CallMcpTool|custom-user-tools|providerIdentifier)\b/gi;
export const scrub = (text: string) => text.replace(INTERNAL, "tool");

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const base = (p: unknown) => str(p).split(/[\\/]+/).filter(Boolean).pop() ?? "";

/** Root field names of a GraphQL document, for a readable title. */
export function graphqlOperations(query: string): string[] {
  try {
    const op = parse(query).definitions.find((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION);
    return (op?.selectionSet.selections ?? []).flatMap((s) => (s.kind === Kind.FIELD && s.name.value !== "__typename" ? [s.name.value] : []));
  } catch {
    return [];
  }
}

/** A plan's title: its first heading, else its first line. */
export function planTitle(markdown: string): string {
  const heading = /^#{1,3}\s+(.+)$/m.exec(markdown)?.[1];
  const first = markdown.split("\n").find((l) => l.trim())?.trim() ?? "";
  return (heading ?? first).replace(/[*_`#]/g, "").trim().slice(0, 120) || "Plan";
}

export function describeTool(name: string, args: Args): Described {
  switch (name) {
    case "shopify_admin": {
      const query = str(args.query);
      const isMutation = /^\s*mutation\b/.test(query);
      const ops = graphqlOperations(query);
      return {
        kind: isMutation ? "store_write" : "store_read",
        title: isMutation ? "Changing the store" : "Reading the store",
        detail: clip(str(args.purpose) || ops.join(", "), 140) || undefined,
      };
    }
    case "shopify_upload_file":
      return { kind: "store_write", title: "Uploading to the store's files", detail: base(args.path) || undefined };
    case "shopify_bulk_export":
      return { kind: "store_read", title: "Exporting from the store", detail: clip(str(args.purpose) || str(args.name), 140) || undefined };
    case "shopify_bulk_update":
      return { kind: "store_write", title: "Changing the store in bulk", detail: clip(str(args.purpose), 140) || undefined };
    case "shopify_schema":
      return { kind: "store_read", title: "Checking the store's API", detail: str(args.type_name) || undefined };
    case "find_product_images":
      return { kind: "image", title: "Finding product photos", detail: clip(str(args.query), 120) || undefined };
    case "save_store_note":
      return { kind: "other", title: "Remembering for this store", detail: clip(str(args.note), 120) || undefined };
    case "run_script":
      return { kind: "file", title: "Analysing the data", detail: Array.isArray(args.inputs) ? clip(args.inputs.map(base).join(", "), 100) : undefined };
    case "ask_user":
      return { kind: "other", title: "Asking you", detail: clip(str(args.question), 120) };
    case "show_file":
      return { kind: "file", title: "Opening", detail: base(args.path) };
    case "list_files":
      return { kind: "file", title: "Looking at the files", detail: str(args.path) || undefined };
    case "read_file":
      return { kind: "file", title: "Reading", detail: base(args.path) };
    case "write_file":
      return { kind: "file", title: "Writing", detail: base(args.path) };
    case "edit_file":
      return { kind: "file", title: "Editing", detail: base(args.path) };
    case "search_files":
      return { kind: "file", title: "Searching the files", detail: clip(`"${str(args.pattern)}"`, 80) };
    case "webSearch":
      return { kind: "web", title: "Searching the web", detail: clip(str(args.searchTerm ?? args.query), 120) || undefined };
    case "webFetch":
      return { kind: "web", title: "Reading a web page", detail: clip(str(args.url), 120) || undefined };
    case "generateImage":
      return { kind: "image", title: "Generating an image", detail: clip(str(args.description), 120) || undefined };
    case "updateTodos":
    case "readTodos":
      return { kind: "plan", title: "Updating the to-dos" };
    case "createPlan":
      return { kind: "plan", title: "Writing the plan", detail: planTitle(str(args.plan)) };
    case "task":
      return { kind: "agent", title: "Working in parallel", detail: clip(str(args.description), 120) || undefined };
    default:
      return { kind: "other", title: "Working" };
  }
}

export function mapTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map((t, i) => {
    const item = (t ?? {}) as Record<string, unknown>;
    const s = str(item.status);
    const status: TodoItem["status"] =
      s === "completed" ? "completed" : s === "cancelled" ? "cancelled" : s === "inProgress" || s === "in_progress" ? "in_progress" : "pending";
    return { id: str(item.id) || String(i), content: clip(scrub(str(item.content)), 300), status };
  });
}

/**
 * updateTodos can send only the items that changed (merge). Apply those to the
 * list shown so far, so the panel never drops to one or two steps mid-run. A
 * short list made only of known steps counts as a merge even without the flag.
 */
export function mergeTodos(previous: TodoItem[], next: TodoItem[], merge: boolean): TodoItem[] {
  const known = (n: TodoItem) => previous.some((p) => p.content === n.content);
  const isMerge = merge || (next.length < previous.length && next.every(known));
  if (!isMerge || !previous.length) return next;
  const out = previous.map((p) => ({ ...p }));
  for (const n of next) {
    const i = out.findIndex((p) => p.content === n.content);
    if (i >= 0) out[i] = { ...out[i]!, status: n.status };
    else out.push(n);
  }
  return out;
}

/** Text of a custom-tool or built-in result, best effort. */
export function resultText(result: unknown): { text: string; isError: boolean } {
  const r = (result ?? {}) as { status?: string; value?: unknown; error?: unknown };
  const value = r.value as { content?: Array<{ text?: unknown }>; isError?: boolean } | undefined;
  const first = value?.content?.[0]?.text;
  const text = typeof first === "string" ? first : typeof (first as { text?: unknown })?.text === "string" ? (first as { text: string }).text : "";
  return { text, isError: r.status === "error" || value?.isError === true || r.error !== undefined };
}

export function summarizeResult(name: string, result: unknown): { ok: boolean; summary?: string } {
  const { text, isError } = resultText(result);
  if (isError) return { ok: false, summary: clip(scrub(text || "failed").replace(/\s+/g, " "), 200) };
  switch (name) {
    case "shopify_admin": {
      try {
        const parsed = JSON.parse(text) as { userErrors?: string[]; errors?: string[] };
        if (parsed.userErrors?.length) return { ok: false, summary: clip(parsed.userErrors.join("; "), 200) };
        if (parsed.errors?.length) return { ok: false, summary: clip(parsed.errors.join("; "), 200) };
      } catch {
        if (/saved to shopify-results/.test(text)) return { ok: true, summary: "large result saved to a file" };
      }
      return { ok: true };
    }
    case "shopify_bulk_export":
    case "shopify_bulk_update":
    case "find_product_images":
    case "run_script": {
      try {
        const first = text.split("\n")[0] ?? "";
        const parsed = JSON.parse(first) as Record<string, unknown>;
        if (name === "shopify_bulk_export") return { ok: true, summary: `${parsed.topLevelRows ?? parsed.records} records exported` };
        if (name === "shopify_bulk_update") {
          const failed = Number(parsed.failed) || 0;
          return { ok: failed === 0, summary: `${parsed.succeeded} changed${failed ? `, ${failed} failed` : ""}` };
        }
        if (name === "find_product_images") return { ok: true, summary: `${(parsed.candidates as unknown[] | undefined)?.length ?? 0} photos found` };
        const files = (parsed.files as string[] | undefined) ?? [];
        return { ok: true, summary: files.length ? `wrote ${files.map(base).join(", ")}` : undefined };
      } catch {
        return { ok: true, summary: text ? clip(scrub(text).replace(/\s+/g, " "), 140) : undefined };
      }
    }
    case "shopify_schema":
    case "webSearch":
    case "webFetch":
    case "generateImage":
    case "updateTodos":
    case "readTodos":
    case "createPlan":
    case "task":
      return { ok: true };
    default:
      return { ok: true, summary: text ? clip(scrub(text).replace(/\s+/g, " "), 140) : undefined };
  }
}

/** A tool call as the SDK's onDelta reports it; custom tools arrive as `mcp`. */
export function unwrapToolCall(toolCall: { type?: string; args?: unknown; result?: unknown }): { name: string; args: Args; result: unknown } {
  const type = str(toolCall.type);
  const args = (toolCall.args ?? {}) as Args;
  if (type === "mcp") {
    const name = str(args.toolName) || str(args.name);
    const inner = (args.args ?? args.arguments ?? {}) as Args;
    return { name, args: inner, result: toolCall.result };
  }
  return { name: type, args, result: toolCall.result };
}

export type ToolStart = Extract<StoreAgentEventInput, { type: "tool_start" }>;

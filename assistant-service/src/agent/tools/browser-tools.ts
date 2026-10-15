import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import {
  ASSISTANT_LIMITS,
  agentTargetSchema,
  isAllowedNavigation,
  isBlockedNavigation,
  type BrowserAction,
} from "../../../../src/lib/assistant/protocol";
import type { AssistantRun } from "../bridge";

type Args = Record<string, unknown>;

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true as const });

function cap(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return raw.length > ASSISTANT_LIMITS.maxSnapshotChars ? `${raw.slice(0, ASSISTANT_LIMITS.maxSnapshotChars)}\n[truncated]` : raw;
}

function target(value: unknown): string | null {
  const parsed = agentTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Run a browser action and turn the browser's answer into a tool result. */
async function perform(run: AssistantRun, action: BrowserAction) {
  try {
    const answer = await run.request(action);
    if (!answer.ok) return failure(answer.error || "The page could not do that");
    return text(cap(answer.result ?? "done"));
  } catch (error) {
    return failure((error as Error).message);
  }
}

const noArgs: Record<string, SDKJsonValue> = { type: "object", properties: {}, required: [] };

/** `{scope}_get_state` and `{scope}_select_rows` for a page that registers page handlers. */
function pageTools(
  run: AssistantRun,
  scope: "gallery" | "visualizer",
  copy: { feature: string; state: string; statuses: string }
): Record<string, SDKCustomTool> {
  return {
    [`${scope}_get_state`]: {
      description: `${copy.feature} only: read the page. Without an open project it lists the projects; with one open it returns ${copy.state}, row counts by status, selected rows, whether a run is active and its progress.`,
      inputSchema: noArgs,
      annotations: { readOnlyHint: true },
      execute: () => perform(run, { kind: "page_get_state", scope }),
    },
    [`${scope}_select_rows`]: {
      description: `${copy.feature} only: choose which products are selected for the next run. mode: all (every row matching the current filter), none, indexes (1-based row numbers), or status (rows whose status is in statuses, for example ${copy.statuses}).`,
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["all", "none", "indexes", "status"] },
          indexes: { type: "array", items: { type: "number" } },
          statuses: { type: "array", items: { type: "string" } },
        },
        required: ["mode"],
      },
      execute: async (args: Args) => {
        const mode = args.mode;
        if (mode !== "all" && mode !== "none" && mode !== "indexes" && mode !== "status") return failure("Invalid mode");
        const indexes = Array.isArray(args.indexes) ? args.indexes.filter((n): n is number => Number.isInteger(n) && n >= 1).slice(0, 500) : undefined;
        const statuses = Array.isArray(args.statuses) ? args.statuses.filter((s): s is string => typeof s === "string").slice(0, 10) : undefined;
        return perform(run, { kind: "page_select_rows", scope, mode, indexes, statuses });
      },
    },
  };
}

/** Tools that act on the user's own browser tab. Created per run. */
export function createBrowserTools(run: AssistantRun): Record<string, SDKCustomTool> {
  return {
    see_page: {
      description:
        "Read the current page as a compact list of controls (id, kind, label, state) and key text. Call it before acting and after every action that changes the page.",
      inputSchema: noArgs,
      annotations: { readOnlyHint: true },
      execute: () => perform(run, { kind: "see_page" }),
    },
    click: {
      description:
        "Click one control by its id from see_page. Controls marked spends_credits only work after the user approved the exact action: pass the approvalToken returned by ask_confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Control id from see_page" },
          approvalToken: { type: "string", description: "Token returned by ask_confirmation, only for spends_credits controls" },
        },
        required: ["target"],
      },
      execute: async (args: Args) => {
        const id = target(args.target);
        if (!id) return failure("Invalid control id");
        const token = typeof args.approvalToken === "string" ? args.approvalToken : undefined;
        return perform(run, { kind: "click", target: id, approvalToken: token });
      },
    },
    type: {
      description: "Type text into an input or text area by its id (replaces the current value).",
      inputSchema: {
        type: "object",
        properties: { target: { type: "string" }, text: { type: "string" } },
        required: ["target", "text"],
      },
      execute: async (args: Args) => {
        const id = target(args.target);
        if (!id || typeof args.text !== "string") return failure("Invalid arguments");
        return perform(run, { kind: "type", target: id, text: args.text.slice(0, 2000) });
      },
    },
    navigate: {
      description: "Open another page of the same workspace, for example /w/{workspaceSlug}/catalog-intelligence.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async (args: Args) => {
        const path = typeof args.path === "string" ? args.path : "";
        if (!isAllowedNavigation(path, run.context.workspaceSlug) || isBlockedNavigation(path)) {
          return failure("That page is not available to the assistant");
        }
        return perform(run, { kind: "navigate", path });
      },
    },
    upload_file: {
      description:
        "Put files the user attached in the chat into a file input by its id. Use the file ids listed in the request context: fileId for one file, or fileIds to add several at once (inputs that accept many, such as image uploads).",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
          fileId: { type: "string" },
          fileIds: { type: "array", items: { type: "string" } },
        },
        required: ["target"],
      },
      execute: async (args: Args) => {
        const id = target(args.target);
        const fileIds = Array.isArray(args.fileIds)
          ? args.fileIds.filter((f): f is string => typeof f === "string").slice(0, 200)
          : undefined;
        const fileId = typeof args.fileId === "string" ? args.fileId : undefined;
        if (!id || (!fileId && !fileIds?.length)) return failure("Invalid arguments");
        return perform(run, { kind: "upload_file", target: id, fileId, fileIds });
      },
    },
    wait_for: {
      description: "Wait until a control appears, or wait a short time (milliseconds, at most 15000). Use it while a process is running.",
      inputSchema: {
        type: "object",
        properties: { target: { type: "string" }, ms: { type: "number" } },
        required: [],
      },
      annotations: { readOnlyHint: true },
      execute: async (args: Args) => {
        const id = args.target === undefined ? undefined : target(args.target);
        if (args.target !== undefined && !id) return failure("Invalid control id");
        const ms = typeof args.ms === "number" ? Math.min(15000, Math.max(100, Math.round(args.ms))) : undefined;
        return perform(run, { kind: "wait_for", target: id ?? undefined, ms });
      },
    },
    ci_get_state: {
      description:
        "Catalog Intelligence only: read the open sheet (row count, selected rows, enabled output columns, source columns, whether an enrichment is running, per-row status counts).",
      inputSchema: noArgs,
      annotations: { readOnlyHint: true },
      execute: () => perform(run, { kind: "ci_get_state" }),
    },
    ci_select_rows: {
      description:
        "Catalog Intelligence only: choose which rows are selected. mode: all, none, indexes (1-based row numbers) or empty_columns (rows where all listed columns are empty).",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["all", "none", "indexes", "empty_columns"] },
          indexes: { type: "array", items: { type: "number" } },
          columns: { type: "array", items: { type: "string" } },
        },
        required: ["mode"],
      },
      execute: async (args: Args) => {
        const mode = args.mode;
        if (mode !== "all" && mode !== "none" && mode !== "indexes" && mode !== "empty_columns") {
          return failure("Invalid mode");
        }
        const indexes = Array.isArray(args.indexes) ? args.indexes.filter((n): n is number => Number.isInteger(n) && n >= 1).slice(0, 500) : undefined;
        const columns = Array.isArray(args.columns) ? args.columns.filter((c): c is string => typeof c === "string").slice(0, 30) : undefined;
        return perform(run, { kind: "ci_select_rows", mode, indexes, columns });
      },
    },
    ci_set_columns: {
      description: "Catalog Intelligence only: turn AI output columns on or off by their label. Read the labels with ci_get_state first.",
      inputSchema: {
        type: "object",
        properties: {
          enable: { type: "array", items: { type: "string" } },
          disable: { type: "array", items: { type: "string" } },
        },
        required: [],
      },
      execute: async (args: Args) => {
        const strings = (value: unknown) =>
          Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 40) : undefined;
        return perform(run, { kind: "ci_set_columns", enable: strings(args.enable), disable: strings(args.disable) });
      },
    },
    ...pageTools(run, "gallery", {
      feature: "Products Gallery",
      state: "the mode (scraping or ai), the settings",
      statuses: "not_started, failed, ready",
    }),
    ...pageTools(run, "visualizer", {
      feature: "Products Visualizer",
      state: "the product image column, the chosen input columns, quality, instructions and branding",
      statuses: "not_started, failed, description_ready, images_ready",
    }),
    classify_get_state: {
      description:
        "Image Classification only: read the page. On the project list it lists the projects; on the new-project page it returns the name, instruction, thinking level, how many images are added and whether it can be submitted; on a result page it returns the status and the groups (label, image count, SKUs).",
      inputSchema: noArgs,
      annotations: { readOnlyHint: true },
      execute: () => perform(run, { kind: "page_get_state", scope: "classify" }),
    },
    visualizer_set_columns: {
      description:
        "Products Visualizer only: choose exactly which worksheet columns describe each product (by header name, as listed in visualizer_get_state). The product image column is set separately with its dropdown.",
      inputSchema: {
        type: "object",
        properties: { columns: { type: "array", items: { type: "string" } } },
        required: ["columns"],
      },
      execute: async (args: Args) => {
        if (!Array.isArray(args.columns)) return failure("Invalid arguments");
        const columns = args.columns.filter((c): c is string => typeof c === "string").slice(0, 200).map((c) => c.slice(0, 200));
        return perform(run, { kind: "page_set_columns", scope: "visualizer", columns });
      },
    },
    ask_confirmation: {
      description:
        "Ask the user to approve an action that spends credits BEFORE doing it. Give a short title and 1 to 5 detail lines (what will run, on how many rows, which columns). The page adds the estimated cost and the balance. Returns approved true with an approvalToken to pass to click, or approved false.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          details: { type: "array", items: { type: "string" } },
          actionTarget: { type: "string", description: "Id of the control that spends credits" },
        },
        required: ["title", "actionTarget"],
      },
      execute: async (args: Args) => {
        const id = target(args.actionTarget);
        if (!id) return failure("Invalid control id");
        const details = Array.isArray(args.details)
          ? args.details.filter((d): d is string => typeof d === "string").slice(0, 8).map((d) => d.slice(0, 300))
          : [];
        try {
          const answer = await run.confirm({
            type: "confirmation",
            callId: run.nextCallId(),
            title: typeof args.title === "string" ? args.title.slice(0, 200) : "Confirm",
            details,
            actionTarget: id,
          });
          if (!answer.ok) return text(JSON.stringify({ approved: false, reason: answer.error || "declined" }));
          return text(cap(answer.result ?? { approved: false }));
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },
  };
}

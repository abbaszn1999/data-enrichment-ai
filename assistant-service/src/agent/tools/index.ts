import type { SDKCustomTool } from "@cursor/sdk";
import type { AssistantRun } from "../bridge";
import { createBrowserTools } from "./browser-tools";
import { listDir, readFile, searchCode } from "./code-tools";

const ok = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const fail = (error: unknown) => ({
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Tool failed" }],
  isError: true as const,
});

/** Read-only tools over the knowledge folder (a copy of the platform source). */
export function createCodeTools(root: string): Record<string, SDKCustomTool> {
  return {
    list_dir: {
      description: "List a folder of the platform source. Path is relative, for example src/app/api. Start with an empty path.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: [] },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        try {
          return ok(await listDir(root, typeof args.path === "string" ? args.path : ""));
        } catch (error) {
          return fail(error);
        }
      },
    },
    read_file: {
      description: "Read a file of the platform source with line numbers (at most 400 lines per call).",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, startLine: { type: "number" }, endLine: { type: "number" } },
        required: ["path"],
      },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        try {
          if (typeof args.path !== "string") return fail(new Error("path is required"));
          const start = typeof args.startLine === "number" ? args.startLine : 1;
          const end = typeof args.endLine === "number" ? args.endLine : undefined;
          return ok(await readFile(root, args.path, start, end));
        } catch (error) {
          return fail(error);
        }
      },
    },
    search_code: {
      description: "Search the platform source for a word or regular expression. Returns file:line: text for the first 60 matches.",
      inputSchema: {
        type: "object",
        properties: { pattern: { type: "string" }, path: { type: "string", description: "Optional folder to search in" } },
        required: ["pattern"],
      },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        try {
          if (typeof args.pattern !== "string") return fail(new Error("pattern is required"));
          return ok(await searchCode(root, args.pattern, typeof args.path === "string" ? args.path : "."));
        } catch (error) {
          return fail(error);
        }
      },
    },
  };
}

export function createAllTools(root: string, run: AssistantRun): Record<string, SDKCustomTool> {
  return { ...createCodeTools(root), ...createBrowserTools(run) };
}

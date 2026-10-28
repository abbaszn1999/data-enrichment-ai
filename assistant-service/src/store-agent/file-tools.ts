import { promises as fs } from "node:fs";
import path from "node:path";
import type { SDKCustomTool } from "@cursor/sdk";

/**
 * File tools confined to one chat folder. They replace Cursor's built-in
 * read/edit/grep/ls tools, which can reach any path on the host (and with it
 * the service's environment and secrets).
 */

const MAX_READ_LINES = 500;
const MAX_LINE_CHARS = 2000;
const MAX_WRITE_BYTES = 10 * 1024 * 1024;
const MAX_MATCHES = 100;
const TEXT_EXT = /\.(md|txt|csv|tsv|json|jsonl|html|xml|svg|yaml|yml|js|mjs|ts|css|log)$/i;

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failure = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: true as const });

/** Resolve inside the folder, following symlinks, so nothing escapes it. */
export async function resolveConfined(root: string, relative: unknown, opts: { mustExist: boolean }): Promise<string> {
  if (typeof relative !== "string" || !relative.trim()) throw new Error("A path is required.");
  if (path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new Error("Use a path relative to your folder.");
  const realRoot = await fs.realpath(root);
  const target = path.resolve(realRoot, relative);
  const inside = (p: string) => {
    const rel = path.relative(realRoot, p);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  if (!inside(target)) throw new Error("That path is outside your folder.");
  try {
    const real = await fs.realpath(target);
    if (!inside(real)) throw new Error("That path is outside your folder.");
    return real;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (opts.mustExist) throw new Error(`There is no file at ${relative}.`);
    // New file: its existing parent must be inside too.
    let parent = path.dirname(target);
    for (;;) {
      try {
        const realParent = await fs.realpath(parent);
        if (!inside(realParent)) throw new Error("That path is outside your folder.");
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        parent = path.dirname(parent);
      }
    }
    return target;
  }
}

async function listTree(root: string, dir: string, depth: number, out: string[]) {
  if (out.length > 500 || depth > 6) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      out.push(`${rel}/`);
      await listTree(root, full, depth + 1, out);
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      out.push(`${rel}  (${stat.size.toLocaleString("en")} bytes)`);
    }
  }
}

export function createFileTools(root: string, onWrite: (relative: string) => void): Record<string, SDKCustomTool> {
  return {
    list_files: {
      description: "List the files in your folder (attachments the user sent, files you created, saved Shopify results).",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "Sub-folder, default the whole folder." } } },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        try {
          const dir = args.path ? await resolveConfined(root, args.path, { mustExist: true }) : await fs.realpath(root);
          const out: string[] = [];
          await listTree(await fs.realpath(root), dir, 0, out);
          return text(out.length ? out.join("\n") : "The folder is empty.");
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

    read_file: {
      description: `Read a text file from your folder with line numbers (up to ${MAX_READ_LINES} lines per call; use offset for more). For images, use show_file to show them to the user.`,
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "number", description: "First line, 1-based." },
          limit: { type: "number", description: `Lines to read, at most ${MAX_READ_LINES}.` },
        },
        required: ["path"],
      },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        try {
          const file = await resolveConfined(root, args.path, { mustExist: true });
          const stat = await fs.stat(file);
          if (stat.isDirectory()) return failure("That is a folder; use list_files.");
          if (!TEXT_EXT.test(file)) {
            return text(`${args.path} is a binary file (${stat.size.toLocaleString("en")} bytes). It cannot be read as text; use show_file to show it or shopify_upload_file to upload it.`);
          }
          const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
          const start = Math.max(1, Math.floor(Number(args.offset) || 1));
          const count = Math.min(MAX_READ_LINES, Math.max(1, Math.floor(Number(args.limit) || MAX_READ_LINES)));
          const slice = lines.slice(start - 1, start - 1 + count);
          const body = slice
            .map((line, i) => `${String(start + i).padStart(6)}|${line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line}`)
            .join("\n");
          const end = start - 1 + slice.length;
          const tail = end < lines.length ? `\n… ${lines.length - end} more lines (offset ${end + 1}).` : "";
          return text(body + tail);
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

    write_file: {
      description: "Create or overwrite a text file in your folder: reports (.md), tables (.csv), data (.json), plans. Then call show_file to show it.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      execute: async (args) => {
        try {
          if (typeof args.content !== "string") return failure("content must be text.");
          if (Buffer.byteLength(args.content) > MAX_WRITE_BYTES) return failure("That file is too large.");
          const file = await resolveConfined(root, args.path, { mustExist: false });
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, args.content, "utf8");
          const relative = path.relative(await fs.realpath(root), file).split(path.sep).join("/");
          onWrite(relative);
          return text(`Wrote ${relative} (${Buffer.byteLength(args.content).toLocaleString("en")} bytes).`);
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

    edit_file: {
      description: "Replace one exact piece of text in a file in your folder. old_text must appear exactly once unless replace_all is true.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string" },
          new_text: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["path", "old_text", "new_text"],
      },
      execute: async (args) => {
        try {
          const file = await resolveConfined(root, args.path, { mustExist: true });
          const oldText = String(args.old_text ?? "");
          const newText = String(args.new_text ?? "");
          if (!oldText) return failure("old_text is empty.");
          const content = await fs.readFile(file, "utf8");
          const count = content.split(oldText).length - 1;
          if (count === 0) return failure("old_text was not found in the file.");
          if (count > 1 && args.replace_all !== true) return failure(`old_text appears ${count} times; make it unique or set replace_all.`);
          await fs.writeFile(file, args.replace_all === true ? content.split(oldText).join(newText) : content.replace(oldText, newText), "utf8");
          const relative = path.relative(await fs.realpath(root), file).split(path.sep).join("/");
          onWrite(relative);
          return text(`Edited ${relative} (${args.replace_all === true ? count : 1} replacement${count > 1 && args.replace_all === true ? "s" : ""}).`);
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

    search_files: {
      description: "Search the text files in your folder for a regular expression. Returns path:line: text.",
      inputSchema: {
        type: "object",
        properties: { pattern: { type: "string" }, path: { type: "string", description: "Sub-folder or file, default everything." } },
        required: ["pattern"],
      },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        try {
          let regex: RegExp;
          try {
            regex = new RegExp(String(args.pattern ?? ""), "i");
          } catch {
            return failure("The pattern is not a valid regular expression.");
          }
          const realRoot = await fs.realpath(root);
          const start = args.path ? await resolveConfined(root, args.path, { mustExist: true }) : realRoot;
          const files: string[] = [];
          const walk = async (p: string) => {
            const stat = await fs.stat(p);
            if (stat.isFile()) return void (TEXT_EXT.test(p) && files.push(p));
            for (const entry of await fs.readdir(p, { withFileTypes: true })) {
              if (entry.name.startsWith(".")) continue;
              await walk(path.join(p, entry.name));
            }
          };
          await walk(start);
          const out: string[] = [];
          for (const file of files) {
            const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
            const rel = path.relative(realRoot, file).split(path.sep).join("/");
            lines.forEach((line, i) => {
              if (out.length < MAX_MATCHES && regex.test(line)) out.push(`${rel}:${i + 1}: ${line.slice(0, 300)}`);
            });
            if (out.length >= MAX_MATCHES) break;
          }
          return text(out.length ? out.join("\n") : "No matches.");
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },
  };
}

import { promises as fs } from "node:fs";
import path from "node:path";
import type { SDKCustomTool } from "@cursor/sdk";
import { convertWord } from "./attachments";
import { makePdf, makeWord } from "./documents";
import { resolveConfined } from "./file-tools";

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failure = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: true as const });

/** Word and PDF files for the user, from Markdown (Arabic reads right to left). */
export function createDocumentTool(root: string, onWrite: (relative: string, folder?: string) => void): Record<string, SDKCustomTool> {
  return {
    make_document: {
      description:
        "Make a Word (.docx) or PDF file for the user to open and download, from Markdown: headings, lists, tables and **bold**. " +
        "Give the Markdown as `content`, or the path of a .md file in your folder as `source`. Set folder to \"store_data\" only for plain store records.",
      inputSchema: {
        type: "object",
        properties: {
          output: { type: "string", description: "Where to write it, ending in .docx or .pdf (e.g. reports/audit.pdf)." },
          content: { type: "string", description: "The document as Markdown." },
          source: { type: "string", description: "Or: a .md file in your folder." },
          folder: { type: "string", enum: ["store_data", "reports"] },
        },
        required: ["output"],
      },
      execute: async (args) => {
        try {
          const output = String(args.output ?? "");
          const format = /\.docx$/i.test(output) ? "docx" : /\.pdf$/i.test(output) ? "pdf" : null;
          if (!format) return failure("output must end in .docx or .pdf.");
          const markdown =
            typeof args.content === "string" ? args.content : typeof args.source === "string" ? await fs.readFile(await resolveConfined(root, args.source, { mustExist: true }), "utf8") : "";
          if (!markdown.trim()) return failure("Give the document as content, or a .md file as source.");
          if (Buffer.byteLength(markdown) > MAX_MARKDOWN_BYTES) return failure("That document is too large.");
          const target = await resolveConfined(root, output, { mustExist: false });
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, new Uint8Array(format === "docx" ? await makeWord(markdown) : await makePdf(markdown)));
          const realRoot = await fs.realpath(root);
          const relative = path.relative(realRoot, target).split(path.sep).join("/");
          // What the panel opens for a Word file: the same page as an uploaded one.
          if (format === "docx") await convertWord(realRoot, relative, `file-views/${relative.replace(/\.[^./]+$/, "")}`);
          onWrite(relative, typeof args.folder === "string" ? args.folder : undefined);
          return text(`Wrote ${relative}. The user can open and download it from the panel.`);
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },
  };
}

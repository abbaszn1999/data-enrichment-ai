// What a chat file is, by its type and its name: browsers report some files
// wrongly (Windows with Excel installed sends a .csv as application/vnd.ms-excel).

const TEXT_MIME = /^(text\/|application\/json)/;
const TEXT_NAME = /\.(csv|tsv|txt|md|json|jsonl|html?|xml|ya?ml|log|js|mjs|ts|css)$/i;
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|svg)$/i;

/** Shown as text in the panel (tables, reports, pages). */
export const isTextFile = (name: string, mime: string) => TEXT_MIME.test(mime) || TEXT_NAME.test(name);

/** Where an attachment named `name` sits in the agent's folder. */
export const attachmentPath = (name: string) => `attachments/${name.replace(/[^\w.\- ()؀-ۿ]+/g, "_").slice(0, 120) || "attachment"}`;

/** An Excel workbook: shown through the tables made from it. */
export const isWorkbook = (name: string) => /\.(xlsx|xlsm|xls)$/i.test(name);

/** Pictures pulled out of an Excel attachment, kept beside it in "<name>-images/". */
export const isExtractedImage = (path: string) => /^attachments\/[^/]+-images\//.test(path) || path.startsWith("file-views/");

/** The pictures a cell lists: one, or several split by lines, "|", commas or spaces. */
export const cellImages = (value: string) =>
  value
    .split(/[\s|]+/)
    .map((v) => v.replace(/^[,;]+|[,;]+$/g, ""))
    .filter(Boolean);

/**
 * The panel's folders: fixed names in a fixed order, the same in every chat.
 * The agent writes where it likes; the platform files each result here.
 */
export const FILE_SECTIONS = [
  { id: "store_data", title: "Store data" },
  { id: "reports", title: "Reports" },
  { id: "images", title: "Images" },
  { id: "plans", title: "Plans" },
  { id: "uploads", title: "Uploads" },
  { id: "working", title: "Working files" },
] as const;

export type FileSectionId = (typeof FILE_SECTIONS)[number]["id"];

/** The folders an agent's file can be in (uploads and plans are not its files). */
export const AGENT_FOLDERS = ["store_data", "reports", "images", "working"] as const;
export type AgentFolder = (typeof AGENT_FOLDERS)[number];

const TABULAR_NAME = /\.(csv|tsv|json|xlsx|xlsm|xls)$/i;

/** Made from another file to open it or read it: reached through that file, never listed. */
export const isDerivedFile = (path: string) => path.startsWith("attachments/") || path.startsWith("file-views/");

/**
 * Which folder one of the agent's files belongs in, or null when it is not
 * listed. By where it came from, not by its format; the agent may say which
 * when the platform cannot tell (a gallery of web images), and a hint that
 * does not fit the file is ignored.
 */
export function classifyAgentFile(file: { path: string; name?: string; shown?: boolean; fromStore?: boolean; hint?: string | null }): AgentFolder | null {
  const { path } = file;
  const name = file.name ?? path;
  if (path.startsWith("backups/") || isDerivedFile(path)) return null;
  // The store's raw answers and JSON lines are for the agent, whatever was opened.
  if (/^(shopify-results|woo-results|previews)\//.test(path) || /\.jsonl$/i.test(name)) return "working";
  if (path.startsWith("exports/")) return "store_data";
  if (!file.shown) return "working";
  const image = IMAGE_NAME.test(name);
  if (file.hint === "images" && (image || /\.json$/i.test(name))) return "images";
  if (file.hint === "store_data" && TABULAR_NAME.test(name)) return "store_data";
  if (file.hint === "reports" && !image) return "reports";
  if (image) return "images";
  if (file.fromStore && TABULAR_NAME.test(name)) return "store_data";
  return "reports";
}

export type ClassifiedFile = { path: string; name: string; created_by: string; shown?: boolean; folder?: string | null };

/** Where a chat file goes in the panel, or null when it is not listed on its own. */
export function fileSection(file: ClassifiedFile): Exclude<FileSectionId, "plans"> | null {
  if (file.path.startsWith("backups/")) return null;
  if (file.created_by === "user") return "uploads";
  if (isDerivedFile(file.path)) return null;
  if (AGENT_FOLDERS.includes(file.folder as AgentFolder)) return file.folder as AgentFolder;
  return classifyAgentFile({ path: file.path, name: file.name, shown: file.shown ?? true });
}

/** The start of the path of what was made from this file to show it. */
export function viewBase(file: { path: string; name: string; created_by: string }): string {
  const base = file.created_by === "user" ? attachmentPath(file.name) : `file-views/${file.path}`;
  return base.replace(/\.[^./]+$/, "");
}

/** Word and PowerPoint files: shown through the page or text made from them. */
export const isOfficeDocument = (name: string) => /\.(docx|pptx)$/i.test(name);

/** Plays in the panel. */
export const mediaKind = (name: string, mime: string): "audio" | "video" | null =>
  mime.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name) ? "video" : mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(name) ? "audio" : null;

/** A table cell that holds pictures: links to images, or image files in the chat. */
export const looksLikeImage = (value: string) => {
  const first = cellImages(value)[0] ?? "";
  if (!first || first.length > 2000) return false;
  if (/^https?:\/\//i.test(first)) return IMAGE_NAME.test(first.split(/[?#]/)[0]!) || /\/cdn\/shop\/|cdn\.shopify\.com/i.test(first);
  return IMAGE_NAME.test(first) && !first.includes("..");
};

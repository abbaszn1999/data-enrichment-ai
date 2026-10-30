// What a chat file is, by its type and its name: browsers report some files
// wrongly (Windows with Excel installed sends a .csv as application/vnd.ms-excel).

const TEXT_MIME = /^(text\/|application\/json)/;
const TEXT_NAME = /\.(csv|tsv|txt|md|json|jsonl|html?)$/i;
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|svg)$/i;

/** Shown as text in the panel (tables, reports, pages). */
export const isTextFile = (name: string, mime: string) => TEXT_MIME.test(mime) || TEXT_NAME.test(name);

/** Where an attachment named `name` sits in the agent's folder. */
export const attachmentPath = (name: string) => `attachments/${name.replace(/[^\w.\- ()؀-ۿ]+/g, "_").slice(0, 120) || "attachment"}`;

/** An Excel workbook: shown through the tables made from it. */
export const isWorkbook = (name: string) => /\.(xlsx|xlsm|xls)$/i.test(name);

/** Pictures pulled out of an Excel attachment, kept beside it in "<name>-images/". */
export const isExtractedImage = (path: string) => /^attachments\/[^/]+-images\//.test(path);

/** The pictures a cell lists: one, or several split by lines, "|", commas or spaces. */
export const cellImages = (value: string) =>
  value
    .split(/[\s|]+/)
    .map((v) => v.replace(/^[,;]+|[,;]+$/g, ""))
    .filter(Boolean);

/** A table cell that holds pictures: links to images, or image files in the chat. */
export const looksLikeImage = (value: string) => {
  const first = cellImages(value)[0] ?? "";
  if (!first || first.length > 2000) return false;
  if (/^https?:\/\//i.test(first)) return IMAGE_NAME.test(first.split(/[?#]/)[0]!) || /\/cdn\/shop\/|cdn\.shopify\.com/i.test(first);
  return IMAGE_NAME.test(first) && !first.includes("..");
};

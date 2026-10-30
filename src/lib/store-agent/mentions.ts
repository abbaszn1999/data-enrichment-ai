// @-mentions in a Store Agent message. The box shows "@Title"; the message
// carries "@[Title](ref)", where ref is a store record (a Shopify gid or a
// woo:// id), a chat file (file://<id>) or a plan (plan://<id>).

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REF = `gid:\\/\\/shopify\\/[A-Za-z]+\\/\\d+|woo:\\/\\/[a-z_]+\\/\\d+|file:\\/\\/${UUID}|plan:\\/\\/${UUID}`;
const MENTION = new RegExp(`@\\[([^\\]\\n]{1,120})\\]\\((${REF})\\)`, "g");

export type MentionKind = "store" | "file" | "plan";
export type MessagePart = { kind: "text"; text: string } | { kind: "mention"; title: string; id: string };

export const fileRef = (fileId: string) => `file://${fileId}`;
export const planRef = (planId: string) => `plan://${planId}`;

export function mentionKind(ref: string): MentionKind {
  return ref.startsWith("file://") ? "file" : ref.startsWith("plan://") ? "plan" : "store";
}

/** The file or plan id a ref points to. */
export const refId = (ref: string) => ref.replace(/^(file|plan):\/\//, "");

/** Split a message into text and mentions. */
export function splitMentions(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    if (match.index! > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    parts.push({ kind: "mention", title: match[1]!, id: match[2]! });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** The message as the user wrote it: "@Title" for each mention. */
export const plainMentions = (text: string) => splitMentions(text).map((p) => (p.kind === "text" ? p.text : `@${p.title}`)).join("");

/** A request in one short line, to say what a file came from. */
export function requestLabel(text: string, max = 80): string {
  const line = plainMentions(text).replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The chat files and plans a message mentions, each once (at most 10 of each). */
export function mentionedIds(text: string): { files: string[]; plans: string[] } {
  const files = new Set<string>();
  const plans = new Set<string>();
  for (const part of splitMentions(text)) {
    if (part.kind !== "mention") continue;
    const kind = mentionKind(part.id);
    if (kind === "file" && files.size < 10) files.add(refId(part.id));
    if (kind === "plan" && plans.size < 10) plans.add(refId(part.id));
  }
  return { files: [...files], plans: [...plans] };
}

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

/** A mention as the composer holds it: the short label in the box, the full title and ref for the agent. */
export type ComposerMention = { label: string; title: string; id: string };

const MAX_LABEL = 26;

/** A title short enough for a chip: whole if it fits, else cut with "…". */
export function mentionLabel(title: string, max = MAX_LABEL): string {
  const clean = title.replace(/[\]\n\r]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** The "@label" spans of `text` that are mentions, longest first so one label inside another never wins. */
function mentionPattern(mentions: readonly ComposerMention[]): RegExp | null {
  if (!mentions.length) return null;
  const labels = [...new Set(mentions.map((m) => m.label))].sort((a, b) => b.length - a.length);
  return new RegExp(labels.map((l) => `@${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).join("|"), "g");
}

/** The box's text split into plain text and mention chips, for drawing. */
export function mentionSegments(text: string, mentions: readonly ComposerMention[]): Array<{ text: string; mention?: ComposerMention }> {
  const pattern = mentionPattern(mentions);
  if (!pattern) return [{ text }];
  const byLabel = new Map(mentions.map((m) => [`@${m.label}`, m]));
  const out: Array<{ text: string; mention?: ComposerMention }> = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) out.push({ text: text.slice(last, match.index) });
    out.push({ text: match[0], mention: byLabel.get(match[0]) });
    last = match.index! + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The message for the agent: each "@label" chip becomes "@[Full title](ref)". */
export function encodeMentions(text: string, mentions: readonly ComposerMention[]): string {
  return mentionSegments(text, mentions)
    .map((s) => (s.mention ? `@[${s.mention.title.replace(/[\]\n\r]+/g, " ").slice(0, 120)}](${s.mention.id})` : s.text))
    .join("");
}

/** The chip that ends exactly at `caret`, if any: Backspace removes it whole. */
export function chipBefore(text: string, caret: number, mentions: readonly ComposerMention[]): { start: number; end: number } | null {
  let pos = 0;
  for (const s of mentionSegments(text, mentions)) {
    const end = pos + s.text.length;
    if (s.mention && end === caret) return { start: pos, end };
    pos = end;
  }
  return null;
}

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

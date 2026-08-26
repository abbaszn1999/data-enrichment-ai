import type { SpecContext } from "../types";

/** The user's own wording wins over the built-in description. */
export function describeColumn(ctx: SpecContext, fallback: string): string {
  return (
    ctx.col.customInstruction?.trim() ||
    ctx.col.description?.trim() ||
    fallback
  );
}

/**
 * The generic "- id (Label) tone= length=: instruction" line every column
 * shows under "Columns to fill", optionally with extra rules indented under it.
 */
export function promptLine(
  ctx: SpecContext,
  fallback: string,
  extraRules: string[] = []
): string {
  const { col } = ctx;
  const tone = col.writingTone ? ` tone=${col.writingTone}` : "";
  const length = col.contentLength ? ` length=${col.contentLength}` : "";
  const custom = col.customInstruction?.trim()
    ? `\n  Extra: ${col.customInstruction.trim()}`
    : "";
  const head = `- ${col.id} (${col.label || col.id})${tone}${length}: ${
    col.description?.trim() || fallback
  }${custom}`;
  const rules = extraRules.filter(Boolean).map((r) => `\n  ${r}`);
  return head + rules.join("");
}

/** Hard character budget, enforced server-side rather than trusting the model. */
export function clampChars(value: string, maxChars?: number): string {
  if (!maxChars || maxChars <= 0 || value.length <= maxChars) return value;
  // Cut on a word boundary when one is close to the limit, else hard cut.
  const slice = value.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.7 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd();
}

export function asTrimmedString(raw: unknown): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) {
    return raw.map((v) => asTrimmedString(v)).filter(Boolean).join(" ");
  }
  // An object here means the model ignored the schema; storing "[object
  // Object]" would be worse than storing nothing.
  if (typeof raw === "object") return "";
  return String(raw).trim();
}

export function asStringList(raw: unknown, limit?: number): string[] {
  const list = Array.isArray(raw)
    ? raw.map((v) => String(v ?? "").trim())
    : asTrimmedString(raw)
      ? [asTrimmedString(raw)]
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (limit && out.length >= limit) break;
  }
  return out;
}

/** Clamp a count-style config value into a sane range. */
export function boundedCount(
  value: number | undefined,
  fallback: number,
  min = 1,
  max = 10
): number {
  return Math.min(max, Math.max(min, value ?? fallback));
}

/**
 * Last segment of a category path, so "Shoes > Running Shoes" and
 * "Running Shoes" compare equal. Handles both " > " and "/" hierarchies.
 */
export function categoryLeaf(value: string): string {
  const parts = value.split(/\s*>\s*|\//).filter((p) => p.trim());
  return (parts[parts.length - 1] ?? value).trim();
}

/**
 * Labels identifying the row being enriched, in both leaf and path form, so a
 * category page is never returned as its own parent or its own related link.
 */
export function buildSelfLabels(rowData: Record<string, string>): Set<string> {
  const raw = [
    rowData.name,
    rowData.Name,
    rowData.title,
    rowData.Title,
    rowData.fullPath,
    rowData.slug,
  ];
  const labels = new Set<string>();
  for (const value of raw) {
    const text = asTrimmedString(value);
    if (!text) continue;
    labels.add(text.toLowerCase());
    labels.add(categoryLeaf(text).toLowerCase());
  }
  return labels;
}

/** True when a category value refers to the row being enriched. */
export function isSelfCategory(
  value: string,
  selfLabels: Set<string>
): boolean {
  if (!value) return false;
  return (
    selfLabels.has(value.toLowerCase()) ||
    selfLabels.has(categoryLeaf(value).toLowerCase())
  );
}

/** A character-budget instruction phrased so the model treats it as hard. */
export function charBudgetRule(maxChars?: number): string {
  if (!maxChars) return "";
  return `Hard limit: at most ${maxChars} characters, including spaces. Do not exceed it.`;
}

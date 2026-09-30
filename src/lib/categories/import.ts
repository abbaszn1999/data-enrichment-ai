import type { CategoryStructure } from "./format";
import type { CategorySheetMapping } from "./column-map";

/**
 * Turns uploaded sheet rows into a category list.
 *
 * - Flat platforms (Shopify collections): every row is one collection, the
 *   parent column is ignored.
 * - Tree platforms (WooCommerce): a row is either
 *     * a name with an explicit Parent (an id, slug, name or full "A > B" path), or
 *     * a full path in the name column ("A > B > C"), which creates any
 *       missing ancestors.
 *   Both shapes can be mixed in one file. Parents may be listed after their
 *   children. Cycles and self-parents fall back to a root category.
 */

export const PATH_SEPARATOR = ">";

export type ImportedCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parentId: string | null;
  originalId: string | null;
};

export type BuildIncomingResult = {
  categories: ImportedCategory[];
  /** Blank names and rows that repeat an earlier category. */
  skipped: number;
  /** Ancestors created because a path or parent name was not listed as its own row. */
  autoCreated: number;
};

export function slugifyCategory(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function splitCategoryPath(value: string): string[] {
  return value
    .split(PATH_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

const isNumeric = (value: string) => /^\d+$/.test(value);
const keyOf = (segments: string[]) => segments.map((s) => s.toLowerCase()).join("\0");

type Entry = {
  segments: string[];
  name: string;
  originalId: string | null;
  slug: string;
  description?: string;
  rawParent: string;
};

type Node = ImportedCategory & { pathKey: string; explicit: boolean };

export function buildIncomingCategories(
  rows: Array<Record<string, string>>,
  mapping: CategorySheetMapping,
  structure: CategoryStructure,
  newId: () => string = () => crypto.randomUUID()
): BuildIncomingResult {
  const tree = structure === "tree";
  let skipped = 0;
  let autoCreated = 0;

  // ---- Parse rows into entries -------------------------------------------
  const entries: Entry[] = [];
  for (const row of rows) {
    const rawName = (row[mapping.name] ?? "").trim();
    if (!rawName) {
      skipped++;
      continue;
    }
    const segments = tree ? splitCategoryPath(rawName) : [rawName];
    if (segments.length === 0) {
      skipped++;
      continue;
    }
    const name = segments[segments.length - 1];
    const originalId = mapping.id && row[mapping.id] ? String(row[mapping.id]).trim() || null : null;
    const fromId =
      originalId && !isNumeric(originalId) && /^[\p{L}\p{N}_-]+$/u.test(originalId)
        ? originalId.toLowerCase()
        : "";
    const description = mapping.description ? (row[mapping.description] ?? "").trim() : "";
    entries.push({
      segments,
      name,
      originalId,
      slug: fromId || slugifyCategory(name) || (originalId ? slugifyCategory(originalId) : "") || newId().slice(0, 8),
      description: description || undefined,
      rawParent: tree && mapping.parent ? (row[mapping.parent] ?? "").trim() : "",
    });
  }

  // ---- Lookups over the entries (parents may come after children) --------
  const entryByOriginalId = new Map<string, number>();
  const entryBySlug = new Map<string, number>();
  const entryByName = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (entry.originalId && !entryByOriginalId.has(entry.originalId)) {
      entryByOriginalId.set(entry.originalId, index);
    }
    if (!entryBySlug.has(entry.slug.toLowerCase())) entryBySlug.set(entry.slug.toLowerCase(), index);
    if (!entryByName.has(entry.name.toLowerCase())) entryByName.set(entry.name.toLowerCase(), index);
  });

  // ---- Node registry ------------------------------------------------------
  const nodes: Node[] = [];
  const nodeById = new Map<string, Node>();
  const nodeByPath = new Map<string, Node>();
  const nodeByName = new Map<string, Node>();

  const pathKeyFor = (parent: Node | null, name: string) =>
    parent ? `${parent.pathKey}\0${name.toLowerCase()}` : name.toLowerCase();

  const place = (parent: Node | null, name: string, entry: Entry | null): Node => {
    const pathKey = pathKeyFor(parent, name);
    const existing = nodeByPath.get(pathKey);
    if (existing) {
      if (entry) {
        if (existing.explicit) {
          skipped++;
        } else {
          existing.explicit = true;
          autoCreated = Math.max(0, autoCreated - 1);
          existing.description = entry.description;
          existing.originalId = entry.originalId;
          existing.slug = entry.slug;
        }
      }
      return existing;
    }
    const node: Node = {
      id: newId(),
      name,
      slug: entry?.slug ?? (slugifyCategory(name) || newId().slice(0, 8)),
      description: entry?.description,
      parentId: parent ? parent.id : null,
      originalId: entry?.originalId ?? null,
      pathKey,
      explicit: !!entry,
    };
    if (!entry) autoCreated++;
    nodes.push(node);
    nodeById.set(node.id, node);
    nodeByPath.set(pathKey, node);
    if (!nodeByName.has(name.toLowerCase())) nodeByName.set(name.toLowerCase(), node);
    return node;
  };

  const ensureChain = (segments: string[], parent: Node | null): Node | null => {
    let current = parent;
    for (const segment of segments) current = place(current, segment, null);
    return current;
  };

  // ---- Resolve entries in dependency order --------------------------------
  const entryNode = new Map<number, Node | null>();
  const visiting = new Set<number>();

  const resolveEntry = (index: number): Node | null => {
    if (entryNode.has(index)) return entryNode.get(index) ?? null;
    visiting.add(index);
    const entry = entries[index];

    const parent = resolveParent(entry, index);
    // A path in the name column ("A > B > C"): everything but the last segment
    // is an ancestor of the row.
    const ancestors = entry.segments.slice(0, -1);
    const base = ancestors.length > 0 ? ensureChain(ancestors, parent) : parent;
    const node = place(base, entry.name, entry);

    visiting.delete(index);
    entryNode.set(index, node);
    return node;
  };

  const resolveParent = (entry: Entry, selfIndex: number): Node | null => {
    const raw = entry.rawParent;
    if (!raw || raw === "0") return null;

    // "A > B" parent: find or create the chain.
    if (raw.includes(PATH_SEPARATOR)) {
      const segments = splitCategoryPath(raw);
      const hit = nodeByPath.get(keyOf(segments));
      return hit ?? ensureChain(segments, null);
    }

    const lower = raw.toLowerCase();
    const candidates = [entryByOriginalId.get(raw), entryBySlug.get(lower), entryByName.get(lower)];
    let blockedByCycle = false;
    for (const candidate of candidates) {
      if (candidate === undefined) continue;
      if (candidate === selfIndex || visiting.has(candidate)) {
        blockedByCycle = true; // self-parent or cycle
        continue;
      }
      return resolveEntry(candidate);
    }
    if (blockedByCycle) return null;

    // Already-created (auto) ancestor with that name.
    const byName = nodeByName.get(lower);
    if (byName) return byName;

    // A parent that is only mentioned by name: create it. Numeric ids that
    // match nothing cannot become a category name, so the row becomes a root.
    if (isNumeric(raw)) return null;
    return place(null, raw, null);
  };

  for (let i = 0; i < entries.length; i++) resolveEntry(i);

  return {
    categories: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      slug: node.slug,
      description: node.description,
      parentId: node.parentId,
      originalId: node.originalId,
    })),
    skipped,
    autoCreated,
  };
}

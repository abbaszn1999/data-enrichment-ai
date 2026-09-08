/**
 * Shopify-style catalogs repeat one product across several rows (color, size,
 * extra images). Enrichment is product-level, so those extra rows must not
 * appear as separate products and must not each cost an AI call.
 *
 * Variant rows stay in storage for export. Grouping only changes which rows
 * are visible / enrichable, then copies product-level results onto siblings.
 */
import type { SessionKind } from "@/types";

export type GroupableRow = {
  id: string;
  rowIndex?: number;
  originalData?: Record<string, string>;
  matchType?: "existing" | "new" | null;
  status?: "pending" | "processing" | "done" | "error";
  errorMessage?: string;
  enrichedData?: Record<string, unknown>;
};

export type ProductGroupIndex = {
  column: string | null;
  enabled: boolean;
  primaryIds: Set<string>;
  primaryIdByRowId: Map<string, string>;
  memberIdsByPrimary: Map<string, string[]>;
  sizeByPrimary: Map<string, number>;
};

const PRODUCT_TITLE_KEYS = new Set([
  "title",
  "name",
  "product title",
  "product name",
  "اسم المنتج",
  "الاسم",
]);

const PRODUCT_BODY_KEYS = new Set([
  "body (html)",
  "body_html",
  "body",
  "description",
  "الوصف",
]);

const GROUP_COLUMN_ALIASES = [
  "handle",
  "product id",
  "product_id",
  "parent sku",
  "parent_sku",
];

function keyNorm(value: string): string {
  return value.trim().toLowerCase();
}

export function cellValue(
  data: Record<string, string> | undefined,
  column: string
): string {
  if (!data) return "";
  if (Object.prototype.hasOwnProperty.call(data, column)) {
    return String(data[column] ?? "").trim();
  }
  const wanted = keyNorm(column);
  for (const [key, value] of Object.entries(data)) {
    if (keyNorm(key) === wanted) return String(value ?? "").trim();
  }
  return "";
}

export function normalizeProductGroupKey(value: string): string {
  return value.trim().toLowerCase();
}

function fieldFromKeys(
  data: Record<string, string> | undefined,
  keys: Set<string>
): string {
  if (!data) return "";
  for (const [key, value] of Object.entries(data)) {
    if (!keys.has(keyNorm(key))) continue;
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function pickPrimary<T extends GroupableRow>(bucket: T[]): T {
  return (
    bucket.find((row) => fieldFromKeys(row.originalData, PRODUCT_TITLE_KEYS)) ||
    bucket.find((row) => fieldFromKeys(row.originalData, PRODUCT_BODY_KEYS)) ||
    bucket[0]!
  );
}

function resolveColumnName(
  columns: string[] | undefined,
  requested: string
): string | null {
  const wanted = keyNorm(requested);
  if (!wanted) return null;
  const match = columns?.find((column) => keyNorm(column) === wanted);
  return match ?? requested.trim();
}

function emptyIndex(): ProductGroupIndex {
  return {
    column: null,
    enabled: false,
    primaryIds: new Set(),
    primaryIdByRowId: new Map(),
    memberIdsByPrimary: new Map(),
    sizeByPrimary: new Map(),
  };
}

/**
 * Prefer Handle on Shopify-style sheets. Only suggest when the column actually
 * repeats; unique handles are already one row per product.
 */
export function suggestProductGroupColumn(
  columns: string[],
  rows: GroupableRow[]
): string | null {
  if (columns.length === 0 || rows.length < 2) return null;
  const candidate =
    columns.find((column) => GROUP_COLUMN_ALIASES.includes(keyNorm(column))) ??
    null;
  if (!candidate) return null;

  const keys = new Set<string>();
  let nonempty = 0;
  for (const row of rows) {
    const raw = cellValue(row.originalData, candidate);
    if (!raw) continue;
    nonempty += 1;
    keys.add(normalizeProductGroupKey(raw));
  }
  if (nonempty < 2) return null;
  if (keys.size >= nonempty) return null;
  return candidate;
}

/**
 * `undefined` = never chosen, auto-detect is allowed.
 * `null` = the user turned grouping off.
 */
export function resolveProductGroupColumn(params: {
  saved?: string | null;
  columns: string[];
  rows: GroupableRow[];
  kind?: SessionKind;
}): string | null {
  if (params.kind === "plp") return null;
  if (params.saved === null) return null;
  if (typeof params.saved === "string" && params.saved.trim()) {
    return resolveColumnName(params.columns, params.saved);
  }
  return suggestProductGroupColumn(params.columns, params.rows);
}

export function buildProductGroupIndex<T extends GroupableRow>(
  rows: T[],
  column: string | null | undefined
): ProductGroupIndex {
  const resolved = column?.trim() ? column.trim() : null;
  if (!resolved || rows.length === 0) {
    const index = emptyIndex();
    for (const row of rows) {
      index.primaryIds.add(row.id);
      index.primaryIdByRowId.set(row.id, row.id);
      index.memberIdsByPrimary.set(row.id, [row.id]);
      index.sizeByPrimary.set(row.id, 1);
    }
    return index;
  }

  const buckets = new Map<string, T[]>();
  const uniqueRows: T[] = [];
  for (const row of rows) {
    const raw = cellValue(row.originalData, resolved);
    if (!raw) {
      uniqueRows.push(row);
      continue;
    }
    const key = normalizeProductGroupKey(raw);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const index: ProductGroupIndex = {
    column: resolved,
    enabled: true,
    primaryIds: new Set(),
    primaryIdByRowId: new Map(),
    memberIdsByPrimary: new Map(),
    sizeByPrimary: new Map(),
  };

  const register = (primary: T, members: T[]) => {
    const memberIds = members.map((row) => row.id);
    index.primaryIds.add(primary.id);
    index.memberIdsByPrimary.set(primary.id, memberIds);
    index.sizeByPrimary.set(primary.id, memberIds.length);
    for (const member of members) {
      index.primaryIdByRowId.set(member.id, primary.id);
    }
  };

  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort(
      (a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0)
    );
    register(pickPrimary(ordered), ordered);
  }
  for (const row of uniqueRows) {
    register(row, [row]);
  }
  return index;
}

export function groupMatchType(
  memberIds: string[],
  byId: Map<string, GroupableRow>
): "existing" | "new" {
  return memberIds.some((id) => byId.get(id)?.matchType === "existing")
    ? "existing"
    : "new";
}

export function visibleCatalogRows<T extends GroupableRow>(
  rows: T[],
  options: {
    groupColumn?: string | null;
    activeSheet?: "existing" | "new" | "all";
  }
): T[] {
  const index = buildProductGroupIndex(rows, options.groupColumn);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const primaries = index.enabled
    ? rows.filter((row) => index.primaryIds.has(row.id))
    : rows;
  const sheet = options.activeSheet ?? "all";
  if (sheet === "all") return primaries;

  return primaries.filter((row) => {
    const members = index.enabled
      ? (index.memberIdsByPrimary.get(row.id) ?? [row.id])
      : [row.id];
    const type = groupMatchType(members, byId);
    return sheet === "existing" ? type === "existing" : type !== "existing";
  });
}

export function countGroupedMatchTypes(
  rows: GroupableRow[],
  column: string | null | undefined
): { existing: number; new: number; products: number; rows: number } {
  const primaries = visibleCatalogRows(rows, {
    groupColumn: column,
    activeSheet: "all",
  });
  const existing = visibleCatalogRows(rows, {
    groupColumn: column,
    activeSheet: "existing",
  }).length;
  return {
    existing,
    new: primaries.length - existing,
    products: primaries.length,
    rows: rows.length,
  };
}

export function collapseToPrimaryRowIds(
  rowIds: string[],
  rows: GroupableRow[],
  column: string | null | undefined
): string[] {
  const index = buildProductGroupIndex(rows, column);
  const known = new Set(rows.map((row) => row.id));
  if (!index.enabled) {
    return [...new Set(rowIds.filter((id) => known.has(id)))];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of rowIds) {
    const primaryId = index.primaryIdByRowId.get(id);
    if (!primaryId || seen.has(primaryId)) continue;
    seen.add(primaryId);
    out.push(primaryId);
  }
  return out;
}

export function expandToGroupMemberIds(
  rowIds: string[],
  rows: GroupableRow[],
  column: string | null | undefined
): string[] {
  const index = buildProductGroupIndex(rows, column);
  if (!index.enabled) return [...new Set(rowIds)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of rowIds) {
    const primaryId = index.primaryIdByRowId.get(id) ?? id;
    const members = index.memberIdsByPrimary.get(primaryId) ?? [id];
    for (const memberId of members) {
      if (seen.has(memberId)) continue;
      seen.add(memberId);
      out.push(memberId);
    }
  }
  return out;
}

/**
 * Copy the primary row's enriched product fields onto its variant siblings and
 * mark those siblings done so export/apply see the same AI result.
 * Returns sibling ids that were updated (never the primary).
 */
export function applyPrimaryEnrichmentToGroup<T extends GroupableRow>(
  rows: T[],
  primaryId: string,
  column: string | null | undefined
): string[] {
  const index = buildProductGroupIndex(rows, column);
  const primary = rows.find((row) => row.id === primaryId);
  if (!primary || !index.enabled) return [];

  const groupPrimaryId = index.primaryIdByRowId.get(primaryId) ?? primaryId;
  const memberIds = index.memberIdsByPrimary.get(groupPrimaryId) ?? [primaryId];
  const payload = { ...(primary.enrichedData ?? {}) };
  const siblingIds: string[] = [];

  for (const row of rows) {
    if (row.id === primaryId) continue;
    if (!memberIds.includes(row.id)) continue;
    row.enrichedData = { ...(row.enrichedData ?? {}), ...payload };
    row.status = "done";
    row.errorMessage = undefined;
    siblingIds.push(row.id);
  }
  return siblingIds;
}

export function partitionRowsForExport<T extends GroupableRow>(
  rows: T[],
  column: string | null | undefined
): { existing: T[]; new: T[] } {
  if (!column) {
    return {
      existing: rows.filter((row) => row.matchType === "existing"),
      new: rows.filter((row) => row.matchType !== "existing"),
    };
  }

  const index = buildProductGroupIndex(rows, column);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const existing: T[] = [];
  const next: T[] = [];
  const assigned = new Set<string>();

  for (const row of rows) {
    if (assigned.has(row.id)) continue;
    const primaryId = index.primaryIdByRowId.get(row.id) ?? row.id;
    const members = (index.memberIdsByPrimary.get(primaryId) ?? [row.id])
      .map((id) => byId.get(id))
      .filter((member): member is T => Boolean(member));
    const bucket =
      groupMatchType(
        members.map((member) => member.id),
        byId
      ) === "existing"
        ? existing
        : next;
    for (const member of members) {
      assigned.add(member.id);
      bucket.push(member);
    }
  }

  return { existing, new: next };
}

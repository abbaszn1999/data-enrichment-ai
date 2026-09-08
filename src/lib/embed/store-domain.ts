/**
 * Canonical store-domain identity for public embed lookup.
 * Exact match only — never substring, never fuzzy.
 */
export const EMBED_DOMAIN_LOOKUP_COLUMNS = ["workspace_id"] as const;

export function normalizeStoreDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

export function collectStoreDomains(
  sources: Array<string | null | undefined>
): string[] {
  const unique = new Set<string>();
  for (const source of sources) {
    const normalized = normalizeStoreDomain(source);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

export function matchWorkspaceIdByDomain(
  rows: Array<{ workspace_id: string; normalized_domain: string }>,
  query: string
): string | null {
  const needle = normalizeStoreDomain(query);
  if (!needle) return null;
  const hit = rows.find((row) => row.normalized_domain === needle);
  return hit?.workspace_id ?? null;
}

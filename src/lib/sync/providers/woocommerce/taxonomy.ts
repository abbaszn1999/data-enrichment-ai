import type { HttpClient } from "../../core/http-client";

type Term = { id: number; name: string; slug: string };
const termsCache = new WeakMap<HttpClient, Map<string, Term[]>>();

export function parseCommaList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchAllTerms(client: HttpClient, path: string): Promise<Term[]> {
  let clientCache = termsCache.get(client);
  if (!clientCache) {
    clientCache = new Map<string, Term[]>();
    termsCache.set(client, clientCache);
  }
  const cached = clientCache.get(path);
  if (cached) return cached;

  const all: Term[] = [];
  let page = 1;
  while (true) {
    const resp = await client.requestRaw(path, {
      method: "GET",
      query: { per_page: 100, page },
    });
    const list = (await resp.json().catch(() => [])) as Term[];
    if (!Array.isArray(list) || list.length === 0) break;
    all.push(...list);
    if (list.length < 100) break;
    page += 1;
    if (page > 50) break; // safety
  }
  clientCache.set(path, all);
  return all;
}

/**
 * Resolves an array of taxonomy term names to {id} objects, creating any missing ones.
 * `path` is the WC endpoint, e.g. "/products/categories" or "/products/tags".
 */
export async function resolveTerms(
  client: HttpClient,
  path: string,
  names: string[],
  existingIds: number[] = []
): Promise<Array<{ id: number }>> {
  if (names.length === 0 && existingIds.length === 0) return [];
  const existing = await fetchAllTerms(client, path);
  const byId = new Map<number, Term>();
  const byNameLower = new Map<string, Term>();
  const bySlugLower = new Map<string, Term>();
  for (const t of existing) {
    if (Number.isInteger(t?.id)) byId.set(t.id, t);
    if (t?.name) byNameLower.set(t.name.toLowerCase(), t);
    if (t?.slug) bySlugLower.set(t.slug.toLowerCase(), t);
  }
  const result: Array<{ id: number }> = [];
  for (const id of existingIds) {
    if (byId.has(id)) {
      result.push({ id });
      continue;
    }
    throw new Error(`WooCommerce taxonomy term ID ${id} was not found at ${path}`);
  }
  for (const name of names) {
    const key = name.toLowerCase();
    const found = byNameLower.get(key) ?? bySlugLower.get(key);
    if (found) {
      result.push({ id: found.id });
      continue;
    }
    const created = await client.post<Term>(path, { name });
    if (created?.id) {
      result.push({ id: created.id });
      byId.set(created.id, created);
      if (created.name) byNameLower.set(created.name.toLowerCase(), created);
      if (created.slug) bySlugLower.set(created.slug.toLowerCase(), created);
      existing.push(created);
      continue;
    }
    throw new Error(`WooCommerce could not create taxonomy term "${name}" at ${path}`);
  }
  return result;
}

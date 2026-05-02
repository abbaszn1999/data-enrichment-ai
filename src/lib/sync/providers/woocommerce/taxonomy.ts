import type { HttpClient } from "../../core/http-client";

type Term = { id: number; name: string; slug: string };

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
  return all;
}

/**
 * Resolves an array of taxonomy term names to {id} objects, creating any missing ones.
 * `path` is the WC endpoint, e.g. "/products/categories" or "/products/tags".
 */
export async function resolveTerms(
  client: HttpClient,
  path: string,
  names: string[]
): Promise<Array<{ id: number }>> {
  if (names.length === 0) return [];
  const existing = await fetchAllTerms(client, path);
  const byNameLower = new Map<string, Term>();
  for (const t of existing) {
    if (t?.name) byNameLower.set(t.name.toLowerCase(), t);
  }
  const result: Array<{ id: number }> = [];
  for (const name of names) {
    const key = name.toLowerCase();
    const found = byNameLower.get(key);
    if (found) {
      result.push({ id: found.id });
      continue;
    }
    // Create new term
    try {
      const created = await client.post<Term>(path, { name });
      if (created?.id) {
        result.push({ id: created.id });
        byNameLower.set(key, created);
      }
    } catch {
      // Skip on failure — non-fatal
    }
  }
  return result;
}

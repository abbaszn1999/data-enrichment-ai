import type {
  ProposedCollection,
  StrategyArticle,
} from "@/components/market-research/workspace-data";

/**
 * The $5 push is the only charge for a collection and also pays for its
 * on-page copy, internal links and articles. Only the push route writes store
 * ids, so the browser cannot mark a collection as paid.
 */
export function isPushedCollection(
  col: Pick<ProposedCollection, "storeHandle" | "storeCollectionId"> | null | undefined
): boolean {
  return Boolean(col?.storeHandle || col?.storeCollectionId);
}

function lastPathSegment(url: string): string {
  let path: string;
  try {
    path = new URL(url, "https://store.invalid").pathname;
  } catch {
    return "";
  }
  const parts = path.split("/").filter(Boolean);
  try {
    return decodeURIComponent(parts[parts.length - 1] ?? "").toLowerCase();
  } catch {
    return (parts[parts.length - 1] ?? "").toLowerCase();
  }
}

/** Articles belong to the project plan; one is covered when it links to a pushed collection. */
export function articleLinksPushedCollection(
  article: Pick<StrategyArticle, "linksOut"> | null | undefined,
  collections: ProposedCollection[]
): boolean {
  if (!article?.linksOut?.length) return false;
  const handles = new Set(
    collections
      .filter(isPushedCollection)
      .map((col) => col.storeHandle?.toLowerCase())
      .filter((handle): handle is string => Boolean(handle))
  );
  if (handles.size === 0) return false;
  return article.linksOut.some((link) => handles.has(lastPathSegment(link.url)));
}

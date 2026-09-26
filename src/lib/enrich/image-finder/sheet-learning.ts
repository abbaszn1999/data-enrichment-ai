import { PRODUCT_MODE_COLUMN_IDS } from "@/types";
import { imageFinderNotFoundKey } from "./not-found";

/**
 * Learns, while a sheet runs, which websites verified its products, so later
 * rows (and one final re-check of Not-found rows) try those websites first.
 * Nothing is hard-coded: the websites come from the client's own sheet.
 */

const IMAGE_COLUMN_ID = PRODUCT_MODE_COLUMN_IDS.images;
export const LEARNED_DOMAIN_MIN_ROWS = 2;
export const LEARNED_DOMAIN_LIMIT = 5;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function imagesOf(data: Record<string, unknown> | undefined): Array<{ pageUrl?: string }> {
  const value = data?.[IMAGE_COLUMN_ID];
  return Array.isArray(value) ? (value as Array<{ pageUrl?: string }>) : [];
}

/** True when an Image Finder result has no images (the cell shows Not found). */
export function isImageFinderNotFound(data: Record<string, unknown> | undefined): boolean {
  return imagesOf(data).length === 0;
}

export class SheetDomainLearner {
  private readonly counts = new Map<string, number>();

  /** Counts each website once per verified row. */
  addRow(data: Record<string, unknown> | undefined): void {
    const hosts = new Set(
      imagesOf(data)
        .map((image) => (image.pageUrl ? hostOf(image.pageUrl) : null))
        .filter((host): host is string => Boolean(host))
    );
    for (const host of hosts) this.counts.set(host, (this.counts.get(host) ?? 0) + 1);
  }

  top(minRows = LEARNED_DOMAIN_MIN_ROWS, limit = LEARNED_DOMAIN_LIMIT): string[] {
    return [...this.counts.entries()]
      .filter(([, count]) => count >= minRows)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([host]) => host);
  }

  static fromRows(rows: Array<{ enrichedData?: Record<string, unknown> }>): SheetDomainLearner {
    const learner = new SheetDomainLearner();
    for (const row of rows) learner.addRow(row.enrichedData);
    return learner;
  }
}

/**
 * Rows that should get the final re-check: targeted in this run, finished
 * with no images and a Not-found reason, not re-checked yet, and there is a
 * learned website they have not been pointed at.
 */
export function rowsNeedingRecheck(input: {
  rows: Array<{ id: string; status?: string; enrichedData?: Record<string, unknown> }>;
  targetIds: string[];
  rechecked: Set<string>;
  learnedDomains: string[];
  domainsTriedByRow: Map<string, string[]>;
}): string[] {
  if (input.learnedDomains.length === 0) return [];
  const targets = new Set(input.targetIds);
  const notFoundKey = imageFinderNotFoundKey(IMAGE_COLUMN_ID);
  return input.rows
    .filter((row) => targets.has(row.id) && !input.rechecked.has(row.id) && row.status === "done")
    .filter((row) => isImageFinderNotFound(row.enrichedData) && Boolean(row.enrichedData?.[notFoundKey]))
    .filter((row) => {
      const tried = new Set(input.domainsTriedByRow.get(row.id) ?? []);
      return input.learnedDomains.some((domain) => !tried.has(domain));
    })
    .map((row) => row.id);
}

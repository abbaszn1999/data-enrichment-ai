/**
 * Sibling keys stored next to the Lens founds list. Client-safe (no server
 * imports) so the agent and the sheet grid share them.
 *
 * - also found: good pages that did not fit "Pages to keep" or the two-per-site
 *   limit, best first. Shown in the cell's popup; other columns never use them.
 * - set aside: pages removed as certainly not a product page, with the reason.
 */
export function lensAlsoFoundKey(columnId: string): string {
  return `${columnId}__alsoFound`;
}

export function lensSetAsideKey(columnId: string): string {
  return `${columnId}__setAside`;
}

export type LensSetAsideReason = "site" | "listing" | "not_page";

export interface LensSetAside {
  uri: string;
  reason: LensSetAsideReason;
}

export const LENS_SET_ASIDE_LABELS: Record<LensSetAsideReason, string> = {
  site: "Video, social, reference or stock-photo site",
  listing: "Category, review or list page",
  not_page: "Home page or file",
};

/** Size limits that keep a row's extra lists small on sheets with thousands of rows. */
export const LENS_ALSO_FOUND_MAX = 20;
export const LENS_SET_ASIDE_MAX = 15;
export const LENS_EXTRA_TITLE_MAX = 120;
export const LENS_SET_ASIDE_URI_MAX = 300;

export function isLensSetAside(value: unknown): value is LensSetAside[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item && typeof item === "object" && typeof (item as LensSetAside).uri === "string")
  );
}

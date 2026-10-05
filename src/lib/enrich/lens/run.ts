import {
  IMAGE_SOURCES_COLUMN_ID,
  LENS_FOUNDS_COLUMN_ID,
  PRODUCT_MODE_COLUMN_IDS,
  SOURCE_URLS_COLUMN_ID,
  type SessionKind,
} from "@/types";

/** A run of the Lens finder: Lens founds is the only column it writes. */
export function isLensRun(kind: SessionKind | null | undefined, enabledColumns: readonly string[]): boolean {
  return kind === "product" && enabledColumns.length === 1 && enabledColumns[0] === LENS_FOUNDS_COLUMN_ID;
}

/**
 * Images, Source URLs and Lens never run together. Returns the message for a
 * request that asks for Lens next to one of the others (or next to any other
 * column), null when the request is fine.
 */
export function lensRunConflict(enabledColumns: readonly string[]): string | null {
  if (!enabledColumns.includes(LENS_FOUNDS_COLUMN_ID)) return null;
  const others = enabledColumns.filter((id) => id !== LENS_FOUNDS_COLUMN_ID);
  if (others.length === 0) return null;
  const finder = others.some(
    (id) =>
      id === PRODUCT_MODE_COLUMN_IDS.images || id === IMAGE_SOURCES_COLUMN_ID || id === SOURCE_URLS_COLUMN_ID
  );
  return finder
    ? "Lens cannot run together with Images or Source URLs. Run one at a time."
    : "Lens runs on its own. Run it without other columns.";
}

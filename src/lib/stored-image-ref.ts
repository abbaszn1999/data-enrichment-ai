/**
 * A picture that lives inside a sheet cell (pasted into Excel / WPS, not a
 * link) is saved to Storage on upload. The cell then holds this stable
 * reference instead of a public or expiring URL; each feature turns it into
 * whatever it needs (a signed link for the model, bytes for the Visualizer, a
 * thumbnail for the table).
 */
export const STORED_IMAGE_PREFIX = "vz-storage:";

const REF_TOKEN_RE = /vz-storage:[^\s,;|"'<>]+/gi;

export function isStoredImageRef(value: string): boolean {
  return value.trim().toLowerCase().startsWith(STORED_IMAGE_PREFIX);
}

export function toStoredImageRef(path: string): string {
  return `${STORED_IMAGE_PREFIX}${path}`;
}

export function storedImagePath(ref: string): string {
  return ref.trim().slice(STORED_IMAGE_PREFIX.length);
}

/** Every stored picture reference in a cell (one per line when a cell holds several). */
export function splitStoredImageRefs(value: string): string[] {
  return value.match(REF_TOKEN_RE) ?? [];
}

export function hasStoredImageRef(value: string): boolean {
  return value.toLowerCase().includes(STORED_IMAGE_PREFIX);
}

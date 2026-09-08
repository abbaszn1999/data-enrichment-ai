/**
 * Root Cause A — row stores.
 * Set any of these to "0" to roll that module back to blobs.
 */
export function productsRowStoreEnabled(): boolean {
  return process.env.PRODUCTS_ROW_STORE !== "0";
}

export function catalogRowStoreEnabled(): boolean {
  return process.env.CATALOG_ROW_STORE !== "0";
}

export function galleryRowStoreEnabled(): boolean {
  return process.env.GALLERY_ROW_STORE !== "0";
}

export function visualizerRowStoreEnabled(): boolean {
  return process.env.VISUALIZER_ROW_STORE !== "0";
}

/**
 * Product-mode framing: the model is describing one specific SKU, so product
 * identity drives what it may state as fact.
 */

export const PRODUCT_ROLE =
  "You enrich ONE ecommerce product for the store's catalog, writing every requested column for it.";

export const PRODUCT_IDENTITY_RULES: string[] = [
  "Identity / web search rules:",
  "- Web search is always available and every row must use it at least once to verify the product and its facts before you write.",
  "- The row data and the attached images decide WHICH product this is. Search to confirm and to fill gaps, never to swap in a different product.",
  "- If the identity is weak (SKU-only, cryptic codes, conflicting fields), search first and say so in `notes`; if it stays unclear, write only what the row supports.",
];

export const PRODUCT_DATA_HEADING = "Product data:";

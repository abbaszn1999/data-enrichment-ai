/**
 * Product-mode framing: the model is describing one specific SKU, so product
 * identity drives whether it must search before writing anything factual.
 */

export const PRODUCT_ROLE = "You enrich ONE ecommerce product for Import AI.";

export const PRODUCT_IDENTITY_RULES: string[] = [
  "Identity / web search rules:",
  "- If brand+model, clear title+type, barcode, or rich description clearly identify the product, you may skip web search for text/categories (images/sources still follow their own rules).",
  "- If identity is weak (SKU-only, cryptic codes, conflicting fields), you MUST use web_search before writing factual fields.",
];

export const PRODUCT_DATA_HEADING = "Product data:";

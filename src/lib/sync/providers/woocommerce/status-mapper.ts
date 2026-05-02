// Map cross-provider status values to WooCommerce-native ones.
// Shopify: active | draft | archived
// WooCommerce: publish | draft | pending | private

export function mapStatusToWoo(input: unknown): string | undefined {
  const value = String(input ?? "").trim().toLowerCase();
  if (!value) return undefined;
  switch (value) {
    case "active":
    case "publish":
    case "published":
      return "publish";
    case "draft":
      return "draft";
    case "pending":
      return "pending";
    case "archived":
    case "private":
      return "private";
    default:
      return value; // pass-through if user supplied a valid Woo status
  }
}

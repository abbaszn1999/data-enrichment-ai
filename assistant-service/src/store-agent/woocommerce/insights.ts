import type { Insight, Mention, StoreInsights } from "../insights";
import { wooRequest, type WooConnection } from "./client";

type ProductRow = { status: string; type: string; stock_status: string; images: unknown[]; description: string };

/** Products and categories whose name matches, for @-mentions in the composer. */
export async function searchWooStore(conn: WooConnection, term: string): Promise<Mention[]> {
  const [products, categories] = await Promise.all([
    wooRequest(conn, { method: "GET", path: "products", query: { search: term, per_page: 7, _fields: "id,name,status,images" } }),
    wooRequest(conn, { method: "GET", path: "products/categories", query: { search: term, per_page: 4, _fields: "id,name,count,image" } }),
  ]);
  const list = <T>(res: { ok: boolean; data: unknown }) => (res.ok && Array.isArray(res.data) ? (res.data as T[]) : []);
  return [
    ...list<{ id: number; name: string; status: string; images?: Array<{ src: string }> }>(products).map((p) => ({
      id: `woo://product/${p.id}`,
      type: "Product" as const,
      title: p.name,
      image: p.images?.[0]?.src ?? null,
      detail: p.status,
    })),
    ...list<{ id: number; name: string; count: number; image: { src: string } | null }>(categories).map((c) => ({
      id: `woo://category/${c.id}`,
      type: "Category" as const,
      title: c.name,
      image: c.image?.src ?? null,
      detail: `${c.count} products`,
    })),
  ];
}

/** The new-chat screen's quick look at the store, from the 100 most recently changed products. */
export async function wooStoreInsights(conn: WooConnection): Promise<StoreInsights> {
  const [productsRes, categoriesRes] = await Promise.all([
    wooRequest(conn, {
      method: "GET",
      path: "products",
      query: { per_page: 100, orderby: "modified", order: "desc", _fields: "status,type,stock_status,images,description" },
    }),
    wooRequest(conn, { method: "GET", path: "products/categories", query: { per_page: 100, _fields: "id,count" } }),
  ]);
  const products = (productsRes.ok && Array.isArray(productsRes.data) ? productsRes.data : []) as ProductRow[];
  const categories = (categoriesRes.ok && Array.isArray(categoriesRes.data) ? categoriesRes.data : []) as Array<{ count: number }>;
  const total = productsRes.total ?? products.length;
  const scanned = products.length;
  const scope = scanned < total ? ` (in the ${scanned} most recently updated)` : "";

  const noImage = products.filter((p) => !p.images?.length).length;
  const drafts = products.filter((p) => p.status === "draft").length;
  const thin = products.filter((p) => (p.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length < 80).length;
  const outOfStock = products.filter((p) => p.status === "publish" && p.stock_status === "outofstock").length;
  const emptyCategories = categories.filter((c) => (c.count ?? 0) === 0).length;

  const insights: Insight[] = [
    {
      id: "no-image",
      count: noImage,
      total: scanned,
      title: `${noImage} products have no image${scope}`,
      prompt: "Find every product without an image, show them in a gallery, then find a real photo for each one and add it after I approve.",
    },
    {
      id: "thin-description",
      count: thin,
      total: scanned,
      title: `${thin} products have a very short description${scope}`,
      prompt: "Rewrite the descriptions that are very short so they are clear and convincing, using only facts already in each product. Show me before and after, then apply after I approve.",
    },
    {
      id: "drafts",
      count: drafts,
      total: scanned,
      title: `${drafts} draft products${scope}`,
      prompt: "List my draft products, tell me which look ready to sell and what is missing on the others, then help me publish the ready ones.",
    },
    {
      id: "out-of-stock",
      count: outOfStock,
      total: scanned,
      title: `${outOfStock} published products are out of stock${scope}`,
      prompt: "Show me the published products that are out of stock (including variable products whose variations are all out of stock) and suggest what to restock first.",
    },
    {
      id: "empty-categories",
      count: emptyCategories,
      total: categories.length,
      title: `${emptyCategories} categories have no products`,
      prompt: "Review my empty categories: why are they empty, and propose which products belong in each or which to remove.",
    },
  ]
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count);

  return { scanned, totalProducts: total, insights };
}

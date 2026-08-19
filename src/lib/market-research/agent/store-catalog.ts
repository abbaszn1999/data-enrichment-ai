import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationRecord } from "@/lib/sync/core/types";
import { fetchShopifyCollections } from "@/lib/sync/providers/shopify/collections";
import { shopifyGraphQL } from "@/lib/sync/providers/shopify/graphql-client";
import { fetchWooCommerceCategories } from "@/lib/sync/providers/woocommerce/categories";
import { createWooClient } from "@/lib/sync/providers/woocommerce/client";
import { MOCK_NICHES } from "@/components/market-research/mock-data";
import type { MarketResearchProduct } from "@/components/market-research/workspace-data";

export type StoreCollectionItem = {
  id: string;
  name: string;
  handle: string;
  description: string;
  productCount: number;
  plpPath: string;
};

export type StoreCatalogResult = {
  storeName: string;
  provider: string;
  baseUrl: string;
  isMock: boolean;
  collections: StoreCollectionItem[];
};

export type ScopeCollectionInput = {
  id: string;
  name: string;
  productCount?: number;
  parentNicheName?: string;
  description?: string;
};

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchStoreCatalog(
  admin: SupabaseClient,
  workspaceId: string
): Promise<StoreCatalogResult> {
  const { data: integrationRow } = await admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!integrationRow || !integrationRow.provider) {
    throw new Error(
      "No active store integration found for this workspace. Please connect Shopify or WooCommerce in Settings first."
    );
  }

  const integration = integrationRow as IntegrationRecord;
  const storeName = integration.integration_name || "Connected Store";
  const provider = String(integration.provider).toLowerCase();
  const baseUrl = integration.base_url || "";

  try {
    if (provider === "shopify") {
      const sheet = await fetchShopifyCollections({
        integration,
        limit: 100,
      });
      const collections: StoreCollectionItem[] = sheet.rows.map((row) => {
        const id = String(row.id ?? "");
        const name = String(row.title ?? "");
        const handle = String(row.handle ?? "");
        const description = stripHtml(String(row.description ?? ""));
        const productCount = Number(row.products_count) || 0;
        const plpPath = handle ? `/collections/${handle}` : "";
        return {
          id: id || handle || name,
          name: name || handle,
          handle,
          description,
          productCount,
          plpPath,
        };
      });

      if (collections.length > 0) {
        return {
          storeName,
          provider: "shopify",
          baseUrl,
          isMock: false,
          collections,
        };
      }
    } else if (provider === "woocommerce" || provider === "wordpress") {
      const sheet = await fetchWooCommerceCategories({
        integration,
        limit: 100,
      });
      const collections: StoreCollectionItem[] = sheet.rows.map((row) => {
        const id = String(row.id ?? "");
        const name = String(row.name ?? "");
        const handle = String(row.slug ?? "");
        const description = stripHtml(String(row.description ?? ""));
        const productCount = Number(row.count) || 0;
        const plpPath = handle ? `/product-category/${handle}` : "";
        return {
          id: id || handle || name,
          name: name || handle,
          handle,
          description,
          productCount,
          plpPath,
        };
      });

      if (collections.length > 0) {
        return {
          storeName,
          provider: "woocommerce",
          baseUrl,
          isMock: false,
          collections,
        };
      }
    }
  } catch (error) {
    console.error("[fetchStoreCatalog] Failed to fetch live collections:", error);
  }

  return getFallbackStoreCatalog(storeName);
}

const SHOPIFY_COLLECTION_PRODUCTS_QUERY = /* GraphQL */ `
  query CollectionProducts($id: ID!, $first: Int!) {
    collection(id: $id) {
      id
      title
      handle
      products(first: $first) {
        edges {
          node {
            id
            title
            handle
            descriptionHtml
            vendor
            productType
            tags
            totalInventory
            featuredMedia {
              ... on MediaImage {
                image { url altText }
              }
              preview { image { url } }
            }
            media(first: 6) {
              nodes {
                preview { image { url } }
              }
            }
            variants(first: 5) {
              nodes {
                id
                price
                compareAtPrice
                title
                selectedOptions { name value }
              }
            }
            options { name values }
          }
        }
      }
    }
  }
`;

export async function fetchStoreProductsForCollections(
  admin: SupabaseClient,
  workspaceId: string,
  selectedCollections: ScopeCollectionInput[]
): Promise<MarketResearchProduct[]> {
  if (!selectedCollections || selectedCollections.length === 0) {
    return [];
  }

  const { data: integrationRow } = await admin
    .from("workspace_integrations")
    .select("provider, integration_name, base_url, config")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!integrationRow || !integrationRow.provider) {
    return generateMockProductsForCollections(selectedCollections, "Demo Store");
  }

  const integration = integrationRow as IntegrationRecord;
  const storeName = integration.integration_name || "Connected Store";
  const provider = String(integration.provider).toLowerCase();
  const baseUrl = (integration.base_url || "").replace(/\/+$/, "");

  const productMap = new Map<string, MarketResearchProduct>();

  try {
    if (provider === "shopify") {
      for (const col of selectedCollections) {
        try {
          const colGid = col.id.startsWith("gid://")
            ? col.id
            : `gid://shopify/Collection/${col.id}`;

          const res = await shopifyGraphQL<{
            collection: {
              id: string;
              title: string;
              handle: string;
              products: {
                edges: Array<{
                  node: {
                    id: string;
                    title: string;
                    handle: string;
                    descriptionHtml?: string;
                    vendor?: string;
                    productType?: string;
                    tags?: string[];
                    totalInventory?: number;
                    featuredMedia?: {
                      image?: { url: string };
                      preview?: { image?: { url: string } };
                    };
                    media?: {
                      nodes: Array<{ preview?: { image?: { url: string } } }>;
                    };
                    variants?: {
                      nodes: Array<{
                        id: string;
                        price: string;
                        compareAtPrice?: string | null;
                        title?: string;
                      }>;
                    };
                    options?: Array<{ name: string; values: string[] }>;
                  };
                }>;
              };
            } | null;
          }>({
            integration,
            query: SHOPIFY_COLLECTION_PRODUCTS_QUERY,
            variables: { id: colGid, first: 50 },
            options: { estimatedCost: 35, tag: "collectionProducts" },
          });

          const edges = res.data?.collection?.products?.edges ?? [];
          for (const edge of edges) {
            const p = edge.node;
            if (!p || !p.id) continue;

            const existing = productMap.get(p.id);
            if (existing) {
              if (!existing.collectionIds.includes(col.id)) {
                existing.collectionIds.push(col.id);
                existing.collectionNames.push(col.name);
              }
              continue;
            }

            const cleanDesc = stripHtml(p.descriptionHtml);
            const shortDesc =
              cleanDesc.length > 200
                ? `${cleanDesc.slice(0, 197).trim()}...`
                : cleanDesc;

            const primaryImg =
              p.featuredMedia?.image?.url ||
              p.featuredMedia?.preview?.image?.url ||
              p.media?.nodes?.[0]?.preview?.image?.url ||
              "";

            const allImages: string[] = [];
            if (primaryImg) allImages.push(primaryImg);
            for (const m of p.media?.nodes ?? []) {
              const url = m.preview?.image?.url;
              if (url && !allImages.includes(url)) allImages.push(url);
            }

            const firstVar = p.variants?.nodes?.[0];
            const amount = Number(firstVar?.price) || 0;
            const compareAt = firstVar?.compareAtPrice
              ? Number(firstVar.compareAtPrice)
              : undefined;

            const attributes: Array<{ name: string; value: string }> = [];
            for (const opt of p.options ?? []) {
              if (opt.name && opt.values && opt.values.length > 0) {
                attributes.push({
                  name: opt.name,
                  value: opt.values.join(", "),
                });
              }
            }

            productMap.set(p.id, {
              id: p.id,
              title: p.title || "Untitled Product",
              handle: p.handle || "",
              url: p.handle ? `${baseUrl}/products/${p.handle}` : "",
              primaryImage: primaryImg,
              images: allImages,
              price: {
                amount,
                currency: "USD",
                compareAtPrice: compareAt,
                priceFormatted: `$${amount.toFixed(2)}`,
              },
              shortDescription: shortDesc,
              fullDescription: cleanDesc,
              vendor: p.vendor || "",
              productType: p.productType || "",
              tags: Array.isArray(p.tags) ? p.tags : [],
              attributes,
              collectionIds: [col.id],
              collectionNames: [col.name],
              inStock: (p.totalInventory ?? 1) > 0,
              totalInventory: p.totalInventory ?? undefined,
            });
          }
        } catch (colErr) {
          console.error(
            `[fetchStoreProductsForCollections] Failed for collection ${col.id}:`,
            colErr
          );
        }
      }

      if (productMap.size > 0) {
        return Array.from(productMap.values());
      }
    } else if (provider === "woocommerce" || provider === "wordpress") {
      const client = createWooClient(integration);
      for (const col of selectedCollections) {
        try {
          const resp = await client.requestRaw("/products", {
            method: "GET",
            query: { category: col.id, per_page: 50, status: "publish" },
          });
          const list = (await resp.json().catch(() => [])) as Array<Record<string, unknown>>;
          if (Array.isArray(list)) {
            for (const p of list) {
              const id = String(p.id ?? "");
              if (!id) continue;

              const existing = productMap.get(id);
              if (existing) {
                if (!existing.collectionIds.includes(col.id)) {
                  existing.collectionIds.push(col.id);
                  existing.collectionNames.push(col.name);
                }
                continue;
              }

              const cleanDesc = stripHtml(String(p.description ?? ""));
              const shortDesc = stripHtml(String(p.short_description ?? "")) || cleanDesc.slice(0, 180);

              const images = Array.isArray(p.images)
                ? (p.images as Array<{ src?: string }>)
                    .map((img) => img.src || "")
                    .filter(Boolean)
                : [];
              const primaryImg = images[0] || "";

              const amount = Number(p.price) || 0;
              const compareAt = p.regular_price ? Number(p.regular_price) : undefined;

              const attributes: Array<{ name: string; value: string }> = [];
              if (Array.isArray(p.attributes)) {
                for (const attr of p.attributes as Array<{ name?: string; options?: unknown }>) {
                  if (attr.name) {
                    const val = Array.isArray(attr.options)
                      ? attr.options.join(", ")
                      : String(attr.options ?? "");
                    attributes.push({ name: attr.name, value: val });
                  }
                }
              }

              const tags = Array.isArray(p.tags)
                ? (p.tags as Array<{ name?: string }>).map((t) => t.name || "").filter(Boolean)
                : [];

              productMap.set(id, {
                id,
                title: String(p.name ?? "Untitled Product"),
                handle: String(p.slug ?? ""),
                url: String(p.permalink ?? (baseUrl ? `${baseUrl}/product/${p.slug}` : "")),
                primaryImage: primaryImg,
                images,
                price: {
                  amount,
                  currency: "USD",
                  compareAtPrice: compareAt,
                  priceFormatted: `$${amount.toFixed(2)}`,
                },
                shortDescription: shortDesc,
                fullDescription: cleanDesc,
                vendor: String(p.vendor ?? ""),
                productType: String(p.type ?? ""),
                tags,
                attributes,
                collectionIds: [col.id],
                collectionNames: [col.name],
                inStock: p.stock_status !== "outofstock",
                totalInventory: typeof p.stock_quantity === "number" ? p.stock_quantity : undefined,
              });
            }
          }
        } catch (wooErr) {
          console.error(
            `[fetchStoreProductsForCollections] WooCommerce failed for collection ${col.id}:`,
            wooErr
          );
        }
      }

      if (productMap.size > 0) {
        return Array.from(productMap.values());
      }
    }
  } catch (err) {
    console.error("[fetchStoreProductsForCollections] Error querying store products:", err);
  }

  return generateMockProductsForCollections(selectedCollections, storeName);
}

export function generateMockProductsForCollections(
  selectedCollections: ScopeCollectionInput[],
  storeName = "Demo Store"
): MarketResearchProduct[] {
  const products: MarketResearchProduct[] = [];
  let seq = 100;

  for (const col of selectedCollections) {
    const nameLower = col.name.toLowerCase();
    const nicheLower = (col.parentNicheName || "").toLowerCase();

    if (nameLower.includes("stylus") || nameLower.includes("pen")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "Pro Pen Stylus Tablet X1 12.4\"",
          handle: "pro-pen-stylus-tablet-x1",
          url: `/products/pro-pen-stylus-tablet-x1`,
          primaryImage:
            "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
            "https://images.unsplash.com/photo-1585770634629-d5a2d659ad76?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 799,
            currency: "USD",
            compareAtPrice: 899,
            priceFormatted: "$799.00",
          },
          shortDescription:
            "12.4-inch 120Hz display with magnetic low-latency active stylus, 256GB storage, and 14-hour battery life.",
          fullDescription:
            "Engineered for digital artists and professionals, the Pro Pen Stylus Tablet X1 delivers ultra-precise pressure sensitivity with 4,096 levels of pen tracking and palm rejection.",
          vendor: storeName,
          productType: "Tablet",
          tags: ["stylus", "drawing", "tablet", "creativity", "touchscreen"],
          attributes: [
            { name: "Screen Size", value: "12.4-inch OLED" },
            { name: "Storage", value: "256GB, 512GB" },
            { name: "Stylus Included", value: "Yes (4096 pressure levels)" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 42,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "UltraTab Creator Pro with Stylus & Stand",
          handle: "ultratab-creator-pro",
          url: `/products/ultratab-creator-pro`,
          primaryImage:
            "https://images.unsplash.com/photo-1585770634629-d5a2d659ad76?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1585770634629-d5a2d659ad76?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 649,
            currency: "USD",
            compareAtPrice: 729,
            priceFormatted: "$649.00",
          },
          shortDescription:
            "High-precision stylus tablet with anti-glare laminated glass and customizable shortcut ring.",
          fullDescription:
            "Designed for sketching, note-taking, and digital illustration with 8ms pen response time and tilt sensitivity.",
          vendor: storeName,
          productType: "Drawing Tablet",
          tags: ["drawing tablet", "stylus", "artist", "pen display"],
          attributes: [
            { name: "Screen Size", value: "11.6-inch IPS" },
            { name: "Pen Tilt", value: "±60 Degrees" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 28,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "NotePad Air Stylus Edition 10.9\"",
          handle: "notepad-air-stylus-edition",
          url: `/products/notepad-air-stylus-edition`,
          primaryImage:
            "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 499,
            currency: "USD",
            priceFormatted: "$499.00",
          },
          shortDescription:
            "Lightweight daily tablet with magnetic wireless charging stylus for seamless note-taking.",
          fullDescription:
            "The perfect digital notebook for students and executives. Features instant palm rejection, paper-feel screen protector, and cloud sync.",
          vendor: storeName,
          productType: "Tablet",
          tags: ["notepad", "stylus tablet", "portable", "notes"],
          attributes: [
            { name: "Screen Size", value: "10.9-inch Liquid Retina" },
            { name: "Weight", value: "460g" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 55,
        }
      );
    } else if (nameLower.includes("tablet")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "GalaxyPad Ultra 12.4\" 5G",
          handle: "galaxypad-ultra-12-4-5g",
          url: `/products/galaxypad-ultra-12-4-5g`,
          primaryImage:
            "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 849,
            currency: "USD",
            compareAtPrice: 999,
            priceFormatted: "$849.00",
          },
          shortDescription:
            "Flagship 120Hz AMOLED tablet with octa-core processor, dual cameras, and all-day battery.",
          fullDescription:
            "Ultimate productivity tablet featuring multi-window split screen, high fidelity quad speakers tuned by Dolby Atmos, and fast charging.",
          vendor: storeName,
          productType: "Tablet",
          tags: ["tablet", "5g", "amoled", "multimedia"],
          attributes: [
            { name: "Screen", value: "12.4\" AMOLED 120Hz" },
            { name: "Storage", value: "256GB" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 30,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "CompactPad Mini 8.4\" Wi-Fi",
          handle: "compactpad-mini-8-4-wifi",
          url: `/products/compactpad-mini-8-4-wifi`,
          primaryImage:
            "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 329,
            currency: "USD",
            priceFormatted: "$329.00",
          },
          shortDescription:
            "One-handed compact entertainment tablet with 2K display and dual stereo speakers.",
          fullDescription:
            "Ultra-lightweight pocket tablet ideal for reading, streaming, gaming on the go with lightweight aluminum body.",
          vendor: storeName,
          productType: "Tablet",
          tags: ["compact tablet", "mini", "ereader", "wifi"],
          attributes: [
            { name: "Screen", value: "8.4\" 2K Retina" },
            { name: "Weight", value: "295g" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 60,
        }
      );
    } else if (nameLower.includes("phone") || nameLower.includes("smartphone")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "Apex Pro 5G Flagship Smartphone 256GB",
          handle: "apex-pro-5g-smartphone",
          url: `/products/apex-pro-5g-smartphone`,
          primaryImage:
            "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 999,
            currency: "USD",
            compareAtPrice: 1099,
            priceFormatted: "$999.00",
          },
          shortDescription:
            "6.7-inch OLED 144Hz display, 200MP AI camera system, and 5000mAh battery.",
          fullDescription:
            "Unrivaled photography with cinematic 8K recording, periscope zoom lens, and ultra-fast next-gen chip.",
          vendor: storeName,
          productType: "Smartphone",
          tags: ["5g", "smartphone", "flagship", "camera phone"],
          attributes: [
            { name: "Storage", value: "256GB / 512GB" },
            { name: "Color", value: "Midnight Black, Titanium Silver" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 50,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "Nova Ultra Compact Smartphone 128GB",
          handle: "nova-ultra-compact-smartphone",
          url: `/products/nova-ultra-compact-smartphone`,
          primaryImage:
            "https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 649,
            currency: "USD",
            priceFormatted: "$649.00",
          },
          shortDescription:
            "Sleek 6.1-inch ergonomics with flagship dual cameras and durable ceramic shield glass.",
          fullDescription:
            "Pocket-friendly performance with fast wireless charging, IP68 water resistance, and vivid HDR screen.",
          vendor: storeName,
          productType: "Smartphone",
          tags: ["compact phone", "smartphone", "dual camera"],
          attributes: [
            { name: "Storage", value: "128GB" },
            { name: "Display", value: "6.1-inch Super Retina" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 35,
        }
      );
    } else if (nameLower.includes("laptop")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "QuantumBook Pro 15.6\" Creator Laptop",
          handle: "quantumbook-pro-15",
          url: `/products/quantumbook-pro-15`,
          primaryImage:
            "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 1499,
            currency: "USD",
            compareAtPrice: 1699,
            priceFormatted: "$1,499.00",
          },
          shortDescription:
            "15.6\" 4K Mini-LED display, 32GB RAM, 1TB NVMe SSD, and dedicated RTX graphics.",
          fullDescription:
            "Built for 3D rendering, video editing, and demanding workloads with thermal vapor chamber cooling.",
          vendor: storeName,
          productType: "Laptop",
          tags: ["laptop", "creator", "4k", "rtx"],
          attributes: [
            { name: "RAM", value: "32GB DDR5" },
            { name: "GPU", value: "RTX 4070" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 20,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "AeroLite Ultrabook 14\" Thin & Light",
          handle: "aerolite-ultrabook-14",
          url: `/products/aerolite-ultrabook-14`,
          primaryImage:
            "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 999,
            currency: "USD",
            priceFormatted: "$999.00",
          },
          shortDescription:
            "0.98kg carbon fiber chassis with 18-hour battery and bright 2.8K 90Hz OLED panel.",
          fullDescription:
            "The ultimate travel laptop for remote professionals and students. Silent fanless design with backlit keyboard.",
          vendor: storeName,
          productType: "Laptop",
          tags: ["ultrabook", "lightweight", "oled", "portable"],
          attributes: [
            { name: "Weight", value: "0.98 kg" },
            { name: "Battery Life", value: "Up to 18 hours" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 40,
        }
      );
    } else if (nameLower.includes("headphone") || nameLower.includes("audio")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "StudioSense Wireless Over-Ear ANC Headphones",
          handle: "studiosense-wireless-anc-headphones",
          url: `/products/studiosense-wireless-anc-headphones`,
          primaryImage:
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 299,
            currency: "USD",
            compareAtPrice: 349,
            priceFormatted: "$299.00",
          },
          shortDescription:
            "Active Hybrid Noise Cancelling, 40mm custom beryllium drivers, and 45h playtime.",
          fullDescription:
            "Immerse yourself in rich acoustic precision with spatial audio head tracking, memory foam ear cups, and multipoint Bluetooth 5.4.",
          vendor: storeName,
          productType: "Headphones",
          tags: ["headphones", "anc", "wireless", "over-ear", "audio"],
          attributes: [
            { name: "Driver Size", value: "40mm Beryllium" },
            { name: "Battery Life", value: "45 Hours (ANC On)" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 75,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "AcousticPro Studio Monitoring Headphones",
          handle: "acousticpro-studio-monitoring-headphones",
          url: `/products/acousticpro-studio-monitoring-headphones`,
          primaryImage:
            "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 179,
            currency: "USD",
            priceFormatted: "$179.00",
          },
          shortDescription:
            "Open-back reference headphones with planar magnetic accuracy and detachable gold-plated cable.",
          fullDescription:
            "Mastering-grade sonic transparency for music producers, sound designers, and audiophiles seeking flat frequency response.",
          vendor: storeName,
          productType: "Headphones",
          tags: ["studio monitor", "open back", "audiophile", "wired"],
          attributes: [
            { name: "Type", value: "Open-Back Planar" },
            { name: "Impedance", value: "32 Ohms" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 30,
        }
      );
    } else if (nameLower.includes("watch")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "PulseFit Active Smartwatch GPS Titanium",
          handle: "pulsefit-active-smartwatch-titanium",
          url: `/products/pulsefit-active-smartwatch-titanium`,
          primaryImage:
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 349,
            currency: "USD",
            compareAtPrice: 399,
            priceFormatted: "$349.00",
          },
          shortDescription:
            "Dual-frequency GPS, ECG heart monitor, sapphire crystal glass, and 100m water resistance.",
          fullDescription:
            "Rugged outdoor smartwatch engineered for endurance athletes and everyday health tracking with 14-day battery life.",
          vendor: storeName,
          productType: "Smartwatch",
          tags: ["smartwatch", "gps", "fitness tracker", "titanium"],
          attributes: [
            { name: "Case Material", value: "Grade 5 Titanium" },
            { name: "Battery", value: "14 Days" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 45,
        }
      );
    } else if (nameLower.includes("sunglass") || nicheLower.includes("eyewear")) {
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: "Aero Aviator Polarized Sunglasses Matte Gold",
          handle: "aero-aviator-polarized-sunglasses",
          url: `/products/aero-aviator-polarized-sunglasses`,
          primaryImage:
            "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 145,
            currency: "USD",
            compareAtPrice: 175,
            priceFormatted: "$145.00",
          },
          shortDescription:
            "Classic teardrop aviator frame with UV400 polarized HD mineral lenses and spring hinges.",
          fullDescription:
            "Crafted with lightweight corrosion-resistant alloy and premium anti-reflective coating for glare-free driving and outdoor clarity.",
          vendor: storeName,
          productType: "Sunglasses",
          tags: ["sunglasses", "polarized", "aviator", "eyewear"],
          attributes: [
            { name: "Frame Color", value: "Matte Gold" },
            { name: "Lens", value: "Polarized Green G-15" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 80,
        },
        {
          id: `demo-prod-${++seq}`,
          title: "Classic Wayfarer Tortoise Polarized Frames",
          handle: "classic-wayfarer-tortoise-sunglasses",
          url: `/products/classic-wayfarer-tortoise-sunglasses`,
          primaryImage:
            "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 129,
            currency: "USD",
            priceFormatted: "$129.00",
          },
          shortDescription:
            "Handcrafted Italian acetate frames with amber polarized lenses for warm natural contrast.",
          fullDescription:
            "Timeless silhouette designed for everyday elegance with 100% UVA/UVB protection and scratch-resistant treatment.",
          vendor: storeName,
          productType: "Sunglasses",
          tags: ["sunglasses", "wayfarer", "tortoise", "acetate"],
          attributes: [
            { name: "Frame Material", value: "Italian Acetate" },
            { name: "Lens", value: "Amber Polarized UV400" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 65,
        }
      );
    } else {
      // Generic high quality product based on collection name
      const cleanCol = col.name.replace(/^AI\s*-\s*/i, "");
      products.push(
        {
          id: `demo-prod-${++seq}`,
          title: `Premium Pro ${cleanCol} Model V1`,
          handle: `premium-pro-${col.id}-model-v1`,
          url: `/products/premium-pro-${col.id}-model-v1`,
          primaryImage:
            "https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 199,
            currency: "USD",
            compareAtPrice: 249,
            priceFormatted: "$199.00",
          },
          shortDescription: `Top rated ${cleanCol.toLowerCase()} designed with premium materials and industry-leading performance.`,
          fullDescription: `Engineered for excellence, this ${cleanCol.toLowerCase()} delivers superior reliability, elegant design, and seamless user experience.`,
          vendor: storeName,
          productType: col.name,
          tags: [cleanCol.toLowerCase(), "premium", "top-rated"],
          attributes: [
            { name: "Grade", value: "Professional" },
            { name: "Warranty", value: "2 Years" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 50,
        },
        {
          id: `demo-prod-${++seq}`,
          title: `Ultra Edition ${cleanCol} Compact`,
          handle: `ultra-edition-${col.id}-compact`,
          url: `/products/ultra-edition-${col.id}-compact`,
          primaryImage:
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
          images: [
            "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80",
          ],
          price: {
            amount: 129,
            currency: "USD",
            priceFormatted: "$129.00",
          },
          shortDescription: `Lightweight and versatile ${cleanCol.toLowerCase()} built for everyday durability.`,
          fullDescription: `Compact form factor featuring robust build quality, ergonomic handling, and high-efficiency specs.`,
          vendor: storeName,
          productType: col.name,
          tags: [cleanCol.toLowerCase(), "compact", "durable"],
          attributes: [
            { name: "Design", value: "Ergonomic Slim" },
            { name: "Color", value: "Obsidian Black" },
          ],
          collectionIds: [col.id],
          collectionNames: [col.name],
          inStock: true,
          totalInventory: 35,
        }
      );
    }
  }

  return products;
}

export function getFallbackStoreCatalog(storeName = "Demo Store"): StoreCatalogResult {
  const collections: StoreCollectionItem[] = [];
  for (const niche of MOCK_NICHES) {
    for (const c of niche.collections) {
      collections.push({
        id: c.id,
        name: c.name,
        handle: c.id,
        description: c.description || "",
        productCount: c.productCount,
        plpPath: c.plpPath || "",
      });
    }
  }
  return {
    storeName,
    provider: "demo",
    baseUrl: "",
    isMock: true,
    collections,
  };
}

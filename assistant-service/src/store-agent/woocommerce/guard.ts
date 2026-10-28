/**
 * What the agent may do on a WooCommerce store. The connection's application
 * password carries every right its WordPress user has, so the limits live
 * here: only the catalogue (products, variations, categories, tags, brands,
 * attributes and their terms) can be read and changed, a few lists can be
 * read, and every other route — orders, customers, coupons, reviews,
 * settings, webhooks, all of WordPress outside wc/v3 — is refused.
 */

export type WooRecordType = "product" | "variation" | "category" | "tag" | "brand" | "attribute" | "attribute_term";

/** A record a change touches, and the fields it sets on it. */
export type WooTarget = { type: WooRecordType; id: number; parent?: number; fields: Record<string, unknown> };

export type WooVerdict =
  | {
      ok: true;
      method: string;
      /** Normalized, relative to wc/v3. */
      path: string;
      risk: "read" | "write" | "delete";
      /** Short name for approval cards and the audit log, e.g. "product.update". */
      operation: string;
      targets: Map<string, WooTarget>;
      /** Records the request creates, changes or deletes. */
      records: number;
      /** A delete that skips the Trash. */
      permanent: boolean;
    }
  | { ok: false; reason: string };

/** WooCommerce's own cap on items in one batch request. */
export const WOO_BATCH_MAX = 100;

type Shape = "collection" | "item" | "batch" | "action" | "readonly";
type Route = { re: RegExp; type: WooRecordType | null; shape: Shape; parentGroup?: number };

const TERM_TYPES: Array<[string, WooRecordType]> = [
  ["categories", "category"],
  ["tags", "tag"],
  ["brands", "brand"],
];

const ROUTES: Route[] = [
  { re: /^products$/, type: "product", shape: "collection" },
  { re: /^products\/batch$/, type: "product", shape: "batch" },
  { re: /^products\/(\d+)$/, type: "product", shape: "item" },
  { re: /^products\/(\d+)\/duplicate$/, type: "product", shape: "action" },
  { re: /^products\/(\d+)\/related$/, type: null, shape: "readonly" },
  { re: /^products\/suggested-products$/, type: null, shape: "readonly" },
  { re: /^products\/(\d+)\/variations$/, type: "variation", shape: "collection", parentGroup: 1 },
  { re: /^products\/(\d+)\/variations\/batch$/, type: "variation", shape: "batch", parentGroup: 1 },
  { re: /^products\/(\d+)\/variations\/generate$/, type: "variation", shape: "action", parentGroup: 1 },
  { re: /^products\/(\d+)\/variations\/(\d+)$/, type: "variation", shape: "item", parentGroup: 1 },
  { re: /^variations$/, type: null, shape: "readonly" },
  ...TERM_TYPES.flatMap(([segment, type]): Route[] => [
    { re: new RegExp(`^products/${segment}$`), type, shape: "collection" },
    { re: new RegExp(`^products/${segment}/batch$`), type, shape: "batch" },
    { re: new RegExp(`^products/${segment}/(\\d+)$`), type, shape: "item" },
  ]),
  { re: /^products\/attributes$/, type: "attribute", shape: "collection" },
  { re: /^products\/attributes\/batch$/, type: "attribute", shape: "batch" },
  { re: /^products\/attributes\/(\d+)$/, type: "attribute", shape: "item" },
  { re: /^products\/attributes\/(\d+)\/terms$/, type: "attribute_term", shape: "collection", parentGroup: 1 },
  { re: /^products\/attributes\/(\d+)\/terms\/batch$/, type: "attribute_term", shape: "batch", parentGroup: 1 },
  { re: /^products\/attributes\/(\d+)\/terms\/(\d+)$/, type: "attribute_term", shape: "item", parentGroup: 1 },
  { re: /^products\/shipping_classes$/, type: null, shape: "readonly" },
  { re: /^products\/shipping_classes\/(\d+)$/, type: null, shape: "readonly" },
  { re: /^products\/custom-fields\/names$/, type: null, shape: "readonly" },
  { re: /^data(\/[a-z_-]+){0,2}$/, type: null, shape: "readonly" },
];

export const WOO_NOT_AVAILABLE =
  "This agent can read and change products, variations, categories, tags, brands, attributes and attribute terms, and read shipping classes. " +
  "Orders, customers, coupons, reviews, reports, settings, shipping zones, taxes, payments, webhooks, system status and the rest of WordPress " +
  "(pages, posts, users, plugins, media library) are not available: tell the user plainly and offer what you can do instead.";

const deny = (reason: string): WooVerdict => ({ ok: false, reason });

/** "/wp-json/wc/v3/products/12/" → "products/12". Null when it is not a plain wc/v3 path. */
export function normalizeWooPath(raw: string): string | null {
  let p = raw.trim();
  if (/^[a-z]+:\/\//i.test(p) || /[?#\\]/.test(p) || p.includes("..")) return null;
  p = p.replace(/^\/+/, "").replace(/^wp-json\//, "").replace(/^wc\/v3\//, "").replace(/\/+$/, "");
  if (!/^[a-z0-9_\-/]+$/i.test(p) || p.includes("//")) return null;
  return p.toLowerCase();
}

const isTrue = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";

const key = (type: WooRecordType, id: number, parent?: number) => `${type}:${parent ? `${parent}/` : ""}${id}`;

function addTarget(targets: Map<string, WooTarget>, type: WooRecordType, id: number, parent: number | undefined, fields: Record<string, unknown>) {
  const k = key(type, id, parent);
  const previous = targets.get(k);
  targets.set(k, { type, id, parent, fields: { ...(previous?.fields ?? {}), ...fields } });
}

function idOf(value: unknown): number | null {
  const n = typeof value === "object" && value !== null ? Number((value as { id?: unknown }).id) : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Check one request against the allowlist and say what it touches. */
export function inspectWooRequest(methodInput: string, rawPath: string, body: unknown, query?: Record<string, unknown> | null): WooVerdict {
  const method = methodInput.toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return deny("Use GET, POST, PUT, PATCH or DELETE.");
  const path = normalizeWooPath(rawPath);
  if (path === null) {
    return deny("Give the path relative to wc/v3 (for example `products/123` or `products/categories`), with query parameters in `query`, not in the path.");
  }
  let route: Route | undefined;
  let match: RegExpExecArray | null = null;
  for (const r of ROUTES) {
    match = r.re.exec(path);
    if (match) {
      route = r;
      break;
    }
  }
  if (!route || !match) return deny(`\`${path}\` is not available. ${WOO_NOT_AVAILABLE}`);

  const parent = route.parentGroup ? Number(match[route.parentGroup]) : undefined;
  const lastId = Number(match[match.length - 1]);
  const targets = new Map<string, WooTarget>();
  const fields = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const ok = (risk: "read" | "write" | "delete", action: string, records: number, permanent = false): WooVerdict => ({
    ok: true,
    method,
    path,
    risk,
    operation: `${route!.type ?? path.split("/").slice(-1)[0]}.${action}`,
    targets,
    records,
    permanent,
  });

  if (method === "GET") return ok("read", "read", 0);
  if (route.shape === "readonly") return deny(`\`${path}\` can only be read.`);
  const type = route.type!;
  // Only products have a Trash; everything else is gone for good when deleted.
  const trashable = type === "product";

  switch (route.shape) {
    case "collection":
      if (method !== "POST") return deny(`Use POST on \`${path}\` to create, or GET to list.`);
      if (Array.isArray(body)) return deny("Create one record per request, or use the batch route / woo_bulk_update for many.");
      return ok("write", "create", 1);
    case "action":
      if (method !== "POST") return deny(`\`${path}\` takes POST.`);
      return ok("write", path.endsWith("generate") ? "generate" : "duplicate", 1);
    case "item":
      if (method === "DELETE") {
        addTarget(targets, type, lastId, parent, {});
        const permanent = !trashable || isTrue(query?.force) || isTrue(fields.force);
        return ok("delete", permanent ? "delete" : "trash", 1, permanent);
      }
      addTarget(targets, type, lastId, parent, fields);
      return ok("write", "update", 1);
    case "batch": {
      if (method === "DELETE") return deny("Batch routes take POST with { create, update, delete } lists.");
      const create = Array.isArray(fields.create) ? fields.create : [];
      const update = Array.isArray(fields.update) ? fields.update : [];
      const del = Array.isArray(fields.delete) ? fields.delete : [];
      const records = create.length + update.length + del.length;
      if (!records) return deny("A batch request needs at least one item in create, update or delete.");
      if (records > WOO_BATCH_MAX) return deny(`WooCommerce accepts at most ${WOO_BATCH_MAX} items per batch request. For more, write the rows to a file and use woo_bulk_update.`);
      for (const item of update) {
        const id = idOf(item);
        if (!id) return deny("Every item in `update` needs its numeric `id`.");
        addTarget(targets, type, id, parent, item as Record<string, unknown>);
      }
      for (const item of del) {
        const id = idOf(item);
        if (!id) return deny("`delete` takes a list of numeric ids.");
        addTarget(targets, type, id, parent, {});
      }
      // WooCommerce's batch delete always skips the Trash.
      if (del.length) return ok("delete", "batch", records, true);
      return ok("write", "batch", records);
    }
    default:
      return deny(`\`${path}\` is not available.`);
  }
}

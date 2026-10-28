import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SDKCustomTool } from "@cursor/sdk";
import { FILES_BUCKET, mimeFor, resolveInChat } from "../files";
import {
  BULK_MIN_RECORDS,
  MAX_SNAPSHOT,
  approveWrite,
  audit,
  compactResult,
  failure,
  freshExportName,
  loadRowsArg,
  markApplied,
  stamp,
  text,
  writeChatFile,
  type ToolContext,
} from "../tool-helpers";
import { wooRequest, type WooConnection } from "./client";
import { exportWooList, wooRecordsToCsv } from "./export";
import { WOO_NOT_AVAILABLE, inspectWooRequest, normalizeWooPath, type WooRecordType, type WooTarget } from "./guard";
import { snapshotWooTargets, wooBatchErrors, wooCollectionPath } from "./snapshot";

/** Records per batch request: WooCommerce allows 100, but shared hosting often times out well before. */
const BATCH_CHUNK = 50;
/** Products moved to the Trash one request at a time (batch deletes skip the Trash). */
const TRASH_CONCURRENCY = 4;
const LINK_TTL_SECONDS = 60 * 60;
const SCOPE = "woocommerce_catalog";

const schemaCache = new Map<string, string>();

async function connect(ctx: ToolContext): Promise<WooConnection | { error: string }> {
  try {
    return await ctx.woo();
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Reads the current values of the records a change touches, for its card and backup. */
function wooSnapshot(ctx: ToolContext, conn: WooConnection, targets: Map<string, WooTarget>) {
  if (!targets.size) return undefined;
  return () => snapshotWooTargets(conn, new Map([...targets].slice(0, MAX_SNAPSHOT)), ctx.run.signal);
}

/** Big list results without the fields nobody reads (links, rendered HTML, srcsets). */
function slim(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slim);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "_links" || k === "price_html" || k === "srcset" || k === "sizes") continue;
    out[k] = slim(v);
  }
  return out;
}

/** What a bulk path refers to: the record type and, for variations and terms, the parent from the path. */
function bulkResource(raw: string): { type: WooRecordType; parent?: number } | null {
  const p = normalizeWooPath(raw);
  if (p === null) return null;
  const fixed: Record<string, WooRecordType> = {
    products: "product",
    variations: "variation",
    "products/categories": "category",
    "products/tags": "tag",
    "products/brands": "brand",
    "products/attributes": "attribute",
  };
  if (fixed[p]) return { type: fixed[p]! };
  let m = /^products\/(\d+)\/variations$/.exec(p);
  if (m) return { type: "variation", parent: Number(m[1]) };
  m = /^products\/attributes\/(\d+)\/terms$/.exec(p);
  if (m) return { type: "attribute_term", parent: Number(m[1]) };
  return null;
}

export function createWooTools(ctx: ToolContext): Record<string, SDKCustomTool> {
  return {
    woo_api: {
      description:
        "Send one request to the connected WooCommerce store's REST API (wc/v3). `path` is relative to wc/v3, e.g. `products`, `products/123`, " +
        "`products/123/variations/456`, `products/categories`, `products/attributes/1/terms`, `products/batch`. " +
        "Access: products, variations, categories, tags, brands, attributes and terms (read and change); shipping classes (read). " +
        "Everything else (orders, customers, coupons, reviews, settings, …) is refused: if the user asks, say so plainly. " +
        "Reads run at once: pass `_fields` in `query` (e.g. `id,name,sku,status,regular_price`) and `per_page` (max 100) to keep results small. " +
        "Changes show before → after to the user for approval first. Batch routes take { create, update, delete } with at most 100 items; " +
        "for more records use woo_bulk_update, and to read many records use woo_export.",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "string", description: "Route relative to wc/v3, without query string." },
          query: { type: "object", description: "Query parameters (search, status, category, include, per_page, page, _fields, force…).", additionalProperties: true },
          body: { type: "object", description: "JSON body for POST/PUT/PATCH.", additionalProperties: true },
          purpose: {
            type: "string",
            description: "One short sentence, in the user's language, saying what this does and to how many records. Shown on approval cards.",
          },
        },
        required: ["method", "path", "purpose"],
      },
      execute: async (args) => {
        const method = String(args.method ?? "GET").toUpperCase();
        const query = args.query && typeof args.query === "object" && !Array.isArray(args.query) ? (args.query as Record<string, unknown>) : null;
        const body = args.body && typeof args.body === "object" ? args.body : undefined;
        const purpose = typeof args.purpose === "string" && args.purpose.trim() ? args.purpose.trim() : "Change the store";
        const verdict = inspectWooRequest(method, String(args.path ?? ""), body, query);
        if (!verdict.ok) return failure(verdict.reason);
        const conn = await connect(ctx);
        if ("error" in conn) return failure(conn.error);

        if (verdict.risk === "read") {
          try {
            const res = await wooRequest(conn, { method: "GET", path: verdict.path, query }, ctx.run.signal);
            if (!res.ok) return failure(`${res.message} (${res.code}, ${res.status})`);
            const payload: Record<string, unknown> = { data: slim(res.data) };
            if (res.total !== null) payload.total = res.total;
            if (res.totalPages !== null) payload.totalPages = res.totalPages;
            return text(await compactResult(ctx, payload));
          } catch (error) {
            return failure((error as Error).message);
          }
        }

        const ids = [...verdict.targets.keys()];
        const risk = verdict.risk === "delete" ? "delete" : verdict.records >= BULK_MIN_RECORDS ? "bulk" : "write";
        const approved = await approveWrite(ctx, {
          risk,
          summary: purpose,
          operations: [verdict.operation],
          rows: Math.max(1, verdict.records),
          snapshot: wooSnapshot(ctx, conn, verdict.targets),
        });
        if (!approved.ok) return failure(approved.message);

        // Re-sending an update writes the same values; re-sending a create or delete could do it twice.
        const isUpdateOnly =
          verdict.operation.endsWith(".update") ||
          (verdict.operation.endsWith(".batch") && verdict.risk === "write" && !Array.isArray((body as { create?: unknown } | undefined)?.create));
        try {
          const res = await wooRequest(conn, { method, path: verdict.path, query, body, retry: isUpdateOnly }, ctx.run.signal);
          const itemErrors = res.ok ? wooBatchErrors(res.data) : [];
          const ok = res.ok && itemErrors.length === 0;
          await audit(ctx, {
            operations: [verdict.operation],
            scopes: [SCOPE],
            query: `${method} ${verdict.path} ${JSON.stringify(body ?? {})}`,
            ids,
            ok,
            error: res.ok ? itemErrors.map((e) => `${e.id ?? "?"}: ${e.message}`).join("; ") || undefined : `${res.code}: ${res.message}`,
            approvalId: approved.approvalId,
          });
          if (res.ok && (itemErrors.length === 0 || itemErrors.length < verdict.records)) await markApplied(ctx, approved.approvalId);
          ctx.checkpoint();
          if (!res.ok) return failure(`The store refused the change: ${res.message} (${res.code}, ${res.status}). Nothing was changed.`);
          const payload: Record<string, unknown> = { data: slim(res.data) };
          if (itemErrors.length) payload.itemErrors = itemErrors;
          if (verdict.operation === "product.trash") payload.note = "The product is in the Trash: the merchant can restore it from Products → Trash in WordPress for 30 days.";
          if (ok) payload.undo = approved.undo;
          return text(await compactResult(ctx, payload));
        } catch (error) {
          const message = (error as Error).message;
          await audit(ctx, { operations: [verdict.operation], scopes: [SCOPE], query: `${method} ${verdict.path}`, ids, ok: false, error: message, approvalId: approved.approvalId });
          return failure(message);
        }
      },
    },

    woo_export: {
      description:
        "Read every record of a list route into your folder (all pages): products, variations (the store's variations; rows carry parent_id), " +
        "products/123/variations, products/categories, products/tags, products/brands, products/attributes, products/attributes/1/terms. " +
        "For the variations of several products, make ONE export of `variations` with `query: { parent: \"12,34,56\" }`, not one export per product. " +
        "Pass filters in `query` (status, type, category, stock_status, search, …) and `_fields` to keep the file small " +
        "(e.g. `id,name,sku,type,status,regular_price,sale_price,stock_status,categories,images`). " +
        "Saved as JSONL plus a flat CSV and opened for the user; analyse it with run_script. Read-only: no approval needed.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          query: { type: "object", additionalProperties: true },
          name: { type: "string", description: "Short file name, e.g. products-prices" },
          purpose: { type: "string", description: "One short sentence in the user's language." },
        },
        required: ["path", "name"],
      },
      execute: async (args) => {
        const query = args.query && typeof args.query === "object" && !Array.isArray(args.query) ? { ...(args.query as Record<string, unknown>) } : {};
        delete query.page;
        delete query.per_page;
        const verdict = inspectWooRequest("GET", String(args.path ?? ""), undefined, query);
        if (!verdict.ok) return failure(verdict.reason);
        if (/\/\d+$/.test(verdict.path)) return failure("That is a single record: read it with woo_api.");
        const conn = await connect(ctx);
        if ("error" in conn) return failure(conn.error);
        const name = await freshExportName(ctx, args.name);
        try {
          const { records, total, truncated } = await exportWooList(conn, verdict.path, query, ctx.run.signal);
          const rows = slim(records) as Array<Record<string, unknown>>;
          const { csv, columns } = wooRecordsToCsv(rows);
          const jsonlPath = await writeChatFile(ctx, `exports/${name}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n"));
          const csvPath = await writeChatFile(ctx, `exports/${name}.csv`, csv, true);
          return text(
            JSON.stringify({
              records: rows.length,
              total,
              truncated,
              csv: csvPath,
              jsonl: jsonlPath,
              columns: columns.slice(0, 60),
              sample: rows.slice(0, 2),
            }).slice(0, 12_000)
          );
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

    woo_bulk_update: {
      description:
        "Create, update or delete many records with ONE approval: write one JSON object per record per line in a .jsonl file in your folder " +
        "(or a .json array), then call this with the list path and the action. `path`: products, variations (each row needs its parent `product_id` or `parent_id`), " +
        "products/123/variations, products/categories, products/tags, products/brands, products/attributes, products/attributes/1/terms. " +
        "Rows for update: `{\"id\":12,\"regular_price\":\"19.90\"}`; for delete: `{\"id\":12}`; for create: the new record's fields. " +
        "The user sees every change before → after and approves once; it runs in batches of 50. Products deleted here go to the Trash " +
        "unless `force` is true; other records are deleted for good.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          action: { type: "string", enum: ["create", "update", "delete"] },
          rows_file: { type: "string", description: "Path in your folder to the .jsonl/.json rows." },
          force: { type: "boolean", description: "Delete products permanently instead of moving them to the Trash." },
          purpose: { type: "string", description: "One short sentence in the user's language: what changes and on how many records." },
        },
        required: ["path", "action", "rows_file", "purpose"],
      },
      execute: async (args) => {
        const action = String(args.action ?? "");
        if (!["create", "update", "delete"].includes(action)) return failure("`action` is create, update or delete.");
        const resource = bulkResource(String(args.path ?? ""));
        if (!resource) return failure(`\`${String(args.path)}\` is not a list this tool can change. ${WOO_NOT_AVAILABLE}`);
        const rows = await loadRowsArg(ctx, args.rows_file);
        if ("error" in rows) return failure(rows.error);

        // Rows grouped by the batch route they go to (variations and terms batch per parent).
        const groups = new Map<string, { parent?: number; items: Array<{ line: number; row: Record<string, unknown> }> }>();
        const targets = new Map<string, WooTarget>();
        for (let i = 0; i < rows.length; i++) {
          // Exported variations carry parent_id; either name for the parent is accepted.
          const { product_id: productId, parent_id: parentId, ...row } = rows[i]!;
          const parent = resource.parent ?? (resource.type === "variation" ? Number(productId ?? parentId) : undefined);
          if (resource.type === "variation" && !(Number.isInteger(parent) && parent! > 0)) {
            return failure(`Line ${i + 1}: each variation row needs its parent \`product_id\` (or use the path products/{id}/variations).`);
          }
          const id = Number(row.id);
          if (action !== "create") {
            if (!Number.isInteger(id) || id <= 0) return failure(`Line ${i + 1}: every row needs its numeric \`id\`.`);
            const key = `${resource.type}:${parent ? `${parent}/` : ""}${id}`;
            targets.set(key, { type: resource.type, id, parent, fields: action === "update" ? row : {} });
          }
          const batchPath = `${wooCollectionPath(resource.type, parent)}/batch`;
          const group = groups.get(batchPath) ?? { parent, items: [] };
          group.items.push({ line: i, row });
          groups.set(batchPath, group);
        }
        const trash = action === "delete" && resource.type === "product" && args.force !== true;
        const operation = `${resource.type}.${trash ? "trash" : action}`;
        const conn = await connect(ctx);
        if ("error" in conn) return failure(conn.error);
        const approved = await approveWrite(ctx, {
          risk: action === "delete" ? "delete" : rows.length >= BULK_MIN_RECORDS ? "bulk" : "write",
          summary: String(args.purpose ?? "Bulk change").trim() || "Bulk change",
          operations: [operation],
          rows: rows.length,
          snapshot: wooSnapshot(ctx, conn, targets),
        });
        if (!approved.ok) return failure(approved.message);

        const failed: Array<{ line: number; id: number | null; message: string }> = [];
        const created: Array<{ line: number; id: number; name?: string; sku?: string }> = [];
        let succeeded = 0;
        let stoppedAt: string | null = null;
        try {
          if (trash) {
            // One request per product: only single deletes can use the Trash.
            const items = [...groups.values()].flatMap((g) => g.items);
            let next = 0;
            const worker = async () => {
              while (next < items.length && !ctx.run.cancelled) {
                const { line, row } = items[next++]!;
                const res = await wooRequest(conn, { method: "DELETE", path: `products/${row.id}` }, ctx.run.signal).catch((e: Error) => ({ ok: false, message: e.message }));
                if (res.ok) succeeded++;
                else failed.push({ line: line + 1, id: Number(row.id), message: String(res.message) });
              }
            };
            await Promise.all(Array.from({ length: Math.min(TRASH_CONCURRENCY, items.length) }, worker));
            if (ctx.run.cancelled && next < items.length) stoppedAt = `stopped after ${next} of ${items.length} products`;
          } else {
            for (const [batchPath, group] of groups) {
              for (let i = 0; i < group.items.length; i += BATCH_CHUNK) {
                if (ctx.run.cancelled) {
                  stoppedAt = "the run was stopped part way";
                  break;
                }
                const chunk = group.items.slice(i, i + BATCH_CHUNK);
                const payload = action === "delete" ? { delete: chunk.map((c) => Number(c.row.id)) } : { [action]: chunk.map((c) => c.row) };
                let res;
                try {
                  res = await wooRequest(conn, { method: "POST", path: batchPath, body: payload, retry: action === "update" }, ctx.run.signal);
                } catch (error) {
                  for (const c of chunk) failed.push({ line: c.line + 1, id: Number(c.row.id) || null, message: (error as Error).message });
                  continue;
                }
                if (!res.ok) {
                  for (const c of chunk) failed.push({ line: c.line + 1, id: Number(c.row.id) || null, message: `${res.message} (${res.code})` });
                  continue;
                }
                const results = ((res.data as Record<string, unknown> | null)?.[action] ?? []) as Array<Record<string, unknown> & { error?: { message?: string } }>;
                chunk.forEach((c, n) => {
                  const item = results[n];
                  if (!item || item.error) {
                    failed.push({ line: c.line + 1, id: Number(item?.id ?? c.row.id) || null, message: String(item?.error?.message ?? "no result").replace(/<[^>]+>/g, "") });
                    return;
                  }
                  succeeded++;
                  if (action === "create") created.push({ line: c.line + 1, id: Number(item.id), name: item.name as string | undefined, sku: (item.sku as string) || undefined });
                });
              }
              if (stoppedAt) break;
            }
          }
        } finally {
          const ok = failed.length === 0 && !stoppedAt;
          await audit(ctx, {
            operations: [operation],
            scopes: [SCOPE],
            query: `bulk ${operation} ${String(args.rows_file)}`,
            ids: [...targets.keys(), ...created.map((c) => `${resource.type}:${c.id}`)],
            ok,
            error: [stoppedAt, ...failed.slice(0, 20).map((f) => `line ${f.line}: ${f.message}`)].filter(Boolean).join("; ") || undefined,
            approvalId: approved.approvalId,
          });
          if (succeeded > 0) await markApplied(ctx, approved.approvalId);
          ctx.checkpoint();
        }
        let resultsFile: string | undefined;
        if (created.length > 20 || failed.length > 15) {
          resultsFile = await writeChatFile(ctx, `results/woo-bulk-${stamp()}.json`, JSON.stringify({ created, failed }, null, 2));
        }
        return text(
          JSON.stringify({
            action,
            rows: rows.length,
            succeeded,
            failed: failed.length,
            errors: failed.slice(0, 15),
            ...(created.length ? { created: created.slice(0, 20) } : {}),
            ...(resultsFile ? { resultsFile } : {}),
            ...(stoppedAt ? { stopped: stoppedAt } : {}),
            ...(trash ? { note: "Deleted products are in the Trash: the merchant can restore them from Products → Trash in WordPress for 30 days." } : {}),
            undo: approved.undo,
          })
        );
      },
    },

    woo_schema: {
      description:
        "Look up what a WooCommerce route accepts before writing a request you are unsure of: its methods, query parameters and the record's fields " +
        "(type, allowed values, read-only). Give the route, e.g. `products`, `products/1/variations`, `products/categories`.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        const verdict = inspectWooRequest("GET", String(args.path ?? ""), undefined, null);
        if (!verdict.ok) return failure(verdict.reason);
        const cacheKey = verdict.path.replace(/\d+/g, "{id}");
        const cached = schemaCache.get(cacheKey);
        if (cached) return text(cached);
        const conn = await connect(ctx);
        if ("error" in conn) return failure(conn.error);
        try {
          const res = await wooRequest(conn, { method: "OPTIONS", path: verdict.path }, ctx.run.signal);
          if (!res.ok) return failure(`${res.message} (${res.code})`);
          type Arg = { type?: string | string[]; enum?: unknown[]; required?: boolean; description?: string };
          type Prop = Arg & { readonly?: boolean; context?: string[]; properties?: Record<string, Prop>; items?: { properties?: Record<string, Prop> } };
          const data = res.data as { endpoints?: Array<{ methods: string[]; args: Record<string, Arg> }>; schema?: { properties?: Record<string, Prop> } };
          const typeOf = (a: Arg) => `${[a.type].flat().filter(Boolean).join("|")}${a.enum ? ` (${a.enum.slice(0, 12).join(", ")})` : ""}${a.required ? " required" : ""}`;
          const lines = [`wc/v3/${cacheKey}`];
          for (const e of data.endpoints ?? []) {
            const methods = e.methods.join(", ");
            if (methods === "GET") lines.push(`GET query: ${Object.entries(e.args).map(([n, a]) => `${n}: ${typeOf(a)}`).join("; ")}`);
          }
          lines.push("Fields:");
          for (const [name, p] of Object.entries(data.schema?.properties ?? {})) {
            const nested = p.properties ?? p.items?.properties;
            const sub = nested ? ` { ${Object.entries(nested).map(([n, s]) => `${n}: ${typeOf(s)}${s.readonly ? " read-only" : ""}`).join(", ")} }` : "";
            lines.push(`  ${name}: ${typeOf(p)}${p.readonly ? " read-only" : ""}${sub}${p.description ? ` — ${p.description}` : ""}`);
          }
          const out = lines.join("\n").slice(0, 14_000);
          schemaCache.set(cacheKey, out);
          return text(out);
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

    woo_image_link: {
      description:
        "Get a temporary https link (1 hour) to an image in your folder (one you generated or the user attached), so the store can download it: " +
        "then add it to a product with woo_api, e.g. PUT products/{id} with images: [{ id: <each current image> }, { src: <link>, alt }], " +
        "or a variation's image: { src: <link> }. WooCommerce copies it into the Media Library when the product is saved.",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "Path inside your folder." } }, required: ["path"] },
      execute: async (args) => {
        let local: string;
        try {
          local = resolveInChat(ctx.files.cwd, String(args.path ?? ""));
        } catch (error) {
          return failure((error as Error).message);
        }
        const mime = mimeFor(local);
        if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return failure("Only PNG, JPEG, WebP or GIF images can be linked.");
        let bytes: Buffer;
        try {
          bytes = await fs.readFile(local);
        } catch {
          return failure(`There is no file at ${args.path}.`);
        }
        const ext = path.extname(local).toLowerCase() || ".png";
        const key = ctx.files.storagePath(`.links/${randomUUID()}${ext}`);
        const bucket = ctx.db.storage.from(FILES_BUCKET);
        const { error } = await bucket.upload(key, bytes, { contentType: mime, upsert: false });
        if (error) return failure(`Could not prepare the link: ${error.message}`);
        const { data, error: signError } = await bucket.createSignedUrl(key, LINK_TTL_SECONDS);
        if (signError || !data?.signedUrl) return failure(`Could not prepare the link: ${signError?.message ?? "no link"}`);
        return text(JSON.stringify({ url: data.signedUrl, expiresInMinutes: LINK_TTL_SECONDS / 60 }));
      },
    },
  };
}

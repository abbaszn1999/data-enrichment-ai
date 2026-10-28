import { promises as fs } from "node:fs";
import path from "node:path";
import type { SDKCustomTool } from "@cursor/sdk";
import { SERPER_USD_PER_QUERY } from "../../../src/lib/store-agent/pricing";
import { MAX_QUESTIONS_PER_CARD } from "../../../src/lib/store-agent/protocol";
import { mimeFor, resolveInChat } from "./files";
import { bulkMutationErrors, exportToCsv, parseBulkLines, runBulkMutation, runBulkQuery } from "./shopify/bulk";
import { grantedScopes, shopifyGraphql, type ShopifyConnection } from "./shopify/client";
import { inspectShopifyDocument, missingScopes } from "./shopify/guard";
import { idempotencyVariables, withIdempotency } from "./shopify/idempotency";
import { SCOPE_LABELS, type OperationRisk, type StoreAgentScope } from "./shopify/scopes";
import { collectTargets, snapshotTargets } from "./shopify/snapshot";
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
  setChatStatus,
  stamp,
  text,
  writeChatFile,
  type ToolContext,
} from "./tool-helpers";
import { createWooTools } from "./woocommerce/tools";

export { BULK_MIN_RECORDS, type ToolContext } from "./tool-helpers";

/** Changes up to this many rows run one by one; larger ones use a Shopify bulk operation. */
const DIRECT_ROWS_MAX = 25;

async function checkScopes(ctx: ToolContext, required: StoreAgentScope[]): Promise<{ conn: ShopifyConnection } | { error: string }> {
  let conn: ShopifyConnection;
  try {
    conn = await ctx.connection();
  } catch (error) {
    return { error: (error as Error).message };
  }
  try {
    const missing = missingScopes(required, await grantedScopes(conn));
    if (missing.length) {
      return {
        error:
          `The store has not given this app permission to ${missing.map((s) => SCOPE_LABELS[s]).join(" and ")}. ` +
          "The store owner can add it in Shopify admin → Settings → Apps and sales channels → Develop apps → the app → Configuration, then reinstall it. Tell the user this.",
      };
    }
  } catch (error) {
    return { error: `Could not check the store's permissions: ${(error as Error).message}` };
  }
  return { conn };
}

function collectUserErrors(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const v of value) collectUserErrors(v, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "userErrors" && Array.isArray(v)) {
      for (const e of v) if (e && typeof e === "object" && "message" in e) out.push(String((e as { message: unknown }).message));
    } else collectUserErrors(v, out, depth + 1);
  }
  return out;
}

/** Reads the current values of the records a Shopify change touches, for its card and backup. */
function shopifySnapshot(ctx: ToolContext, conn: ShopifyConnection, targets: Map<string, Record<string, unknown>>) {
  if (!targets.size) return undefined;
  return () => snapshotTargets(conn, new Map([...targets].slice(0, MAX_SNAPSHOT)), ctx.run.signal);
}

const introspectionCache = new Map<string, string>();

/** The tools for the connected store's platform, plus those every store gets. */
export function createStoreAgentTools(ctx: ToolContext): Record<string, SDKCustomTool> {
  const store = ctx.platform === "woocommerce" ? createWooTools(ctx) : createShopifyTools(ctx);
  return { ...store, ...createSharedTools(ctx) };
}

function createShopifyTools(ctx: ToolContext): Record<string, SDKCustomTool> {
  return {
    shopify_admin: {
      description:
        "Run one GraphQL query or mutation on the connected Shopify store (Admin API 2026-04). " +
        "Access: products, variants, collections, inventory, locations, files and sales channels (publications). " +
        "Everything else (orders, customers, discounts, themes, pages, …) is not available: if the user asks, say so plainly. " +
        "Reads run at once. Changes show before → after to the user for approval first. For more than a few records, prefer shopify_bulk_update " +
        "(one approval, one Shopify bulk operation). To read thousands of records, use shopify_bulk_export. Always select userErrors on mutations.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "One GraphQL query or mutation document." },
          variables: { type: "object", description: "Variables for the document.", additionalProperties: true },
          purpose: {
            type: "string",
            description: "One short sentence, in the user's language, saying what this does and to how many records. Shown on approval cards.",
          },
        },
        required: ["query", "purpose"],
      },
      execute: async (args) => {
        const query = typeof args.query === "string" ? args.query : "";
        const variables = args.variables && typeof args.variables === "object" ? (args.variables as Record<string, unknown>) : null;
        const purpose = typeof args.purpose === "string" && args.purpose.trim() ? args.purpose.trim() : "Change the store";

        const verdict = inspectShopifyDocument(query, variables);
        if (!verdict.ok) return failure(verdict.reason);
        const scoped = await checkScopes(ctx, verdict.requiredScopes);
        if ("error" in scoped) return failure(scoped.error);
        const conn = scoped.conn;

        let approvalId: string | undefined;
        let undo: string | undefined;
        if (verdict.risk !== "read") {
          const targets = collectTargets(variables);
          for (const id of verdict.ids) if (!targets.has(id)) targets.set(id, {});
          const approved = await approveWrite(ctx, {
            risk: verdict.risk,
            summary: purpose,
            operations: verdict.operations,
            rows: Math.max(1, targets.size),
            snapshot: shopifySnapshot(ctx, conn, targets),
          });
          if (!approved.ok) return failure(approved.message);
          approvalId = approved.approvalId;
          undo = approved.undo;
        }

        const isMutation = verdict.kind === "mutation";
        const idempotent = isMutation ? withIdempotency(query) : null;
        try {
          const res = idempotent
            ? await shopifyGraphql(conn, idempotent, idempotencyVariables(variables), ctx.run.signal)
            : await shopifyGraphql(conn, query, variables, ctx.run.signal);
          const errors = res.errors?.map((e) => e.message) ?? [];
          const userErrors = collectUserErrors(res.data);
          if (isMutation) {
            const ok = errors.length === 0 && userErrors.length === 0;
            await audit(ctx, { operations: verdict.operations, scopes: verdict.requiredScopes, query, ids: verdict.ids, ok, error: [...errors, ...userErrors].join("; ") || undefined, approvalId });
            if (approvalId && ok) await markApplied(ctx, approvalId);
            ctx.checkpoint();
          }
          const payload: Record<string, unknown> = { data: res.data };
          if (errors.length) payload.errors = errors;
          if (userErrors.length) payload.userErrors = userErrors;
          if (undo && !errors.length && !userErrors.length) payload.undo = undo;
          if (res.extensions?.cost?.throttleStatus) payload.cost = res.extensions.cost;
          const body = await compactResult(ctx, payload);
          return errors.length && !res.data ? failure(body) : text(body);
        } catch (error) {
          const message = (error as Error).message;
          if (isMutation) await audit(ctx, { operations: verdict.operations, scopes: verdict.requiredScopes, query, ids: verdict.ids, ok: false, error: message, approvalId });
          return failure(message);
        }
      },
    },

    shopify_bulk_export: {
      description:
        "Export many records at once with a Shopify bulk operation (thousands of products, variants, collections, inventory…). " +
        "Write the query WITHOUT pagination arguments (no first/after), with edges/node, e.g. " +
        "`{ products { edges { node { id title status totalInventory seo { title description } featuredMedia { id } } } } }`. " +
        "The result is saved in your folder as JSONL plus a flat CSV (top-level records; nested connections become counts) and opened for the user. " +
        "Use run_script to analyse it. Read-only: no approval needed.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          name: { type: "string", description: "Short file name, e.g. products-seo" },
          purpose: { type: "string", description: "One short sentence in the user's language." },
        },
        required: ["query", "name"],
      },
      execute: async (args) => {
        const query = String(args.query ?? "");
        const verdict = inspectShopifyDocument(query, null);
        if (!verdict.ok) return failure(verdict.reason);
        if (verdict.kind !== "query") return failure("shopify_bulk_export takes a query.");
        const scoped = await checkScopes(ctx, verdict.requiredScopes);
        if ("error" in scoped) return failure(scoped.error);
        const name = await freshExportName(ctx, args.name);
        try {
          const result = await runBulkQuery(scoped.conn, query, ctx.run.signal);
          if (result.status !== "COMPLETED") return failure(`The export ended with status ${result.status}${result.errorCode ? ` (${result.errorCode})` : ""}.`);
          const lines = parseBulkLines(result.jsonl);
          const { csv, rows, columns } = exportToCsv(lines);
          const jsonlPath = await writeChatFile(ctx, `exports/${name}.jsonl`, result.jsonl || "");
          const csvPath = await writeChatFile(ctx, `exports/${name}.csv`, csv, true);
          return text(
            JSON.stringify({
              records: lines.length,
              topLevelRows: rows,
              csv: csvPath,
              jsonl: jsonlPath,
              columns: columns.slice(0, 60),
              sample: lines.filter((l) => !l.__parentId).slice(0, 3),
            })
          );
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

    shopify_bulk_update: {
      description:
        "Apply ONE mutation to many records with a single approval: write the variables for each record as one JSON object per line " +
        "in a .jsonl file in your folder (or a .json array), then call this with the mutation. Example mutation: " +
        "`mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id } userErrors { field message } } }` " +
        "with lines like `{\"product\":{\"id\":\"gid://shopify/Product/1\",\"seo\":{\"title\":\"…\"}}}`. " +
        "The user sees every change before → after in a table and approves once; up to 25 rows run directly, more run as a Shopify bulk operation. " +
        "Use this instead of many shopify_admin calls whenever more than a few records change.",
      inputSchema: {
        type: "object",
        properties: {
          mutation: { type: "string", description: "One mutation using variables only (no literal ids)." },
          rows_file: { type: "string", description: "Path in your folder to the .jsonl/.json rows." },
          purpose: { type: "string", description: "One short sentence in the user's language: what changes and on how many records." },
        },
        required: ["mutation", "rows_file", "purpose"],
      },
      execute: async (args) => {
        const mutation = String(args.mutation ?? "");
        const rows = await loadRowsArg(ctx, args.rows_file);
        if ("error" in rows) return failure(rows.error);
        const verdict = inspectShopifyDocument(mutation, { rows });
        if (!verdict.ok) return failure(verdict.reason);
        if (verdict.kind !== "mutation" || verdict.operations.length !== 1) return failure("Pass exactly one mutation with one root field.");
        const scoped = await checkScopes(ctx, verdict.requiredScopes);
        if ("error" in scoped) return failure(scoped.error);
        const conn = scoped.conn;

        const targets = collectTargets(rows);
        const risk: Exclude<OperationRisk, "read"> = verdict.risk === "delete" ? "delete" : rows.length >= BULK_MIN_RECORDS ? "bulk" : "write";
        const approved = await approveWrite(ctx, {
          risk,
          summary: String(args.purpose ?? "Bulk change").trim() || "Bulk change",
          operations: verdict.operations,
          rows: rows.length,
          snapshot: shopifySnapshot(ctx, conn, targets),
        });
        if (!approved.ok) return failure(approved.message);

        const ids = [...targets.keys()];
        // Each row is its own change, so each gets its own idempotency key.
        const idempotent = withIdempotency(mutation);
        const document = idempotent ?? mutation;
        const rowVariables = idempotent ? rows.map((r) => idempotencyVariables(r)) : rows;
        try {
          let failed: Array<{ line: number; message: string }> = [];
          let mode: "direct" | "bulk";
          if (rows.length <= DIRECT_ROWS_MAX) {
            mode = "direct";
            for (let i = 0; i < rowVariables.length; i++) {
              if (ctx.run.cancelled) throw new Error("The run was stopped part way.");
              const res = await shopifyGraphql(conn, document, rowVariables[i], ctx.run.signal);
              for (const message of [...(res.errors?.map((e) => e.message) ?? []), ...collectUserErrors(res.data)]) failed.push({ line: i, message });
            }
          } else {
            mode = "bulk";
            const result = await runBulkMutation(conn, document, rowVariables, ctx.run.signal);
            if (result.status !== "COMPLETED") throw new Error(`The bulk change ended with status ${result.status}${result.errorCode ? ` (${result.errorCode})` : ""}.`);
            const lines = parseBulkLines(result.jsonl);
            failed = bulkMutationErrors(lines);
            await writeChatFile(ctx, `results/bulk-${stamp()}.jsonl`, result.jsonl);
          }
          const failedLines = new Set(failed.map((f) => f.line));
          const ok = failedLines.size === 0;
          await audit(ctx, { operations: verdict.operations, scopes: verdict.requiredScopes, query: mutation, ids, ok, error: failed.slice(0, 20).map((f) => `line ${f.line}: ${f.message}`).join("; ") || undefined, approvalId: approved.approvalId });
          if (rows.length - failedLines.size > 0) await markApplied(ctx, approved.approvalId);
          ctx.checkpoint();
          return text(
            JSON.stringify({
              mode,
              rows: rows.length,
              succeeded: rows.length - failedLines.size,
              failed: failedLines.size,
              errors: failed.slice(0, 15),
              undo: approved.undo,
            })
          );
        } catch (error) {
          await audit(ctx, { operations: verdict.operations, scopes: verdict.requiredScopes, query: mutation, ids, ok: false, error: (error as Error).message, approvalId: approved.approvalId });
          return failure((error as Error).message);
        }
      },
    },

    shopify_schema: {
      description:
        "Look up a Shopify Admin API type before writing a query or mutation: its fields, arguments, input fields or enum values. " +
        "Use it when unsure of a field or input name (e.g. ProductUpdateInput, ProductVariantsBulkInput, Product).",
      inputSchema: { type: "object", properties: { type_name: { type: "string" } }, required: ["type_name"] },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        const name = String(args.type_name ?? "").trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return failure("Give a GraphQL type name.");
        const cached = introspectionCache.get(name);
        if (cached) return text(cached);
        let conn: ShopifyConnection;
        try {
          conn = await ctx.connection();
        } catch (error) {
          return failure((error as Error).message);
        }
        const typeRef = "name kind ofType { name kind ofType { name kind ofType { name kind } } }";
        const res = await shopifyGraphql(
          conn,
          `query($name: String!) { __type(name: $name) { name kind description
            fields { name description args { name type { ${typeRef} } } type { ${typeRef} } }
            inputFields { name description type { ${typeRef} } }
            enumValues { name } } }`,
          { name },
          ctx.run.signal
        ).catch((e: Error) => ({ data: null, errors: [{ message: e.message }] }));
        type TypeRef = { name: string | null; kind: string; ofType?: TypeRef | null };
        const typeName = (t: TypeRef | null | undefined): string =>
          !t ? "?" : t.kind === "NON_NULL" ? `${typeName(t.ofType)}!` : t.kind === "LIST" ? `[${typeName(t.ofType)}]` : (t.name ?? "?");
        const type = (res.data as { __type?: Record<string, unknown> | null } | null)?.__type;
        if (!type) return failure(`No type named ${name}.`);
        const lines = [`${type.name} (${type.kind})`];
        for (const f of (type.fields as Array<{ name: string; args: Array<{ name: string; type: TypeRef }>; type: TypeRef }> | null) ?? []) {
          lines.push(`  ${f.name}${f.args.length ? `(${f.args.map((a) => `${a.name}: ${typeName(a.type)}`).join(", ")})` : ""}: ${typeName(f.type)}`);
        }
        for (const f of (type.inputFields as Array<{ name: string; type: TypeRef }> | null) ?? []) lines.push(`  ${f.name}: ${typeName(f.type)}`);
        const enums = (type.enumValues as Array<{ name: string }> | null) ?? [];
        if (enums.length) lines.push(`  values: ${enums.map((e) => e.name).join(", ")}`);
        const out = lines.join("\n").slice(0, 12_000);
        introspectionCache.set(name, out);
        return text(out);
      },
    },

    shopify_upload_file: {
      description:
        "Upload a file from your folder (for example an image you generated or the user attached) to the store's Files, " +
        "and return its Shopify file id and URL. To put it on a product, then use shopify_admin " +
        "(productUpdate with media, or fileUpdate with referencesToAdd). Asks the user first unless Auto-run is on.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path inside your folder." },
          alt: { type: "string", description: "Alt text for the image." },
          purpose: { type: "string", description: "One short sentence, in the user's language, for the approval card." },
        },
        required: ["path"],
      },
      execute: async (args) => {
        let local: string;
        try {
          local = resolveInChat(ctx.files.cwd, String(args.path ?? ""));
        } catch (error) {
          return failure((error as Error).message);
        }
        let bytes: Buffer;
        try {
          bytes = await fs.readFile(local);
        } catch {
          return failure(`There is no file at ${args.path}.`);
        }
        const filename = path.basename(local);
        const mime = mimeFor(filename);
        const isImage = mime.startsWith("image/");
        const alt = typeof args.alt === "string" ? args.alt.slice(0, 512) : undefined;

        const scoped = await checkScopes(ctx, ["write_files"]);
        if ("error" in scoped) return failure(scoped.error);
        const conn = scoped.conn;
        const approved = await approveWrite(ctx, {
          risk: "write",
          summary: typeof args.purpose === "string" && args.purpose.trim() ? args.purpose : `Upload ${filename} to the store's files`,
          operations: ["stagedUploadsCreate", "fileCreate"],
          rows: 1,
        });
        if (!approved.ok) return failure(approved.message);

        try {
          const staged = await shopifyGraphql(
            conn,
            `mutation($input: [StagedUploadInput!]!) {
              stagedUploadsCreate(input: $input) {
                stagedTargets { url resourceUrl parameters { name value } }
                userErrors { field message }
              }
            }`,
            { input: [{ resource: isImage ? "IMAGE" : "FILE", filename, mimeType: mime, httpMethod: "POST", fileSize: String(bytes.length) }] },
            ctx.run.signal
          );
          const target = (staged.data as {
            stagedUploadsCreate?: { stagedTargets?: Array<{ url: string; resourceUrl: string; parameters: Array<{ name: string; value: string }> }> };
          } | null)?.stagedUploadsCreate?.stagedTargets?.[0];
          if (!target) return failure(`Shopify did not accept the upload: ${collectUserErrors(staged.data).join("; ") || "no upload target"}`);

          const form = new FormData();
          for (const p of target.parameters) form.append(p.name, p.value);
          form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
          const put = await fetch(target.url, { method: "POST", body: form, signal: ctx.run.signal });
          if (!put.ok) return failure(`The upload to Shopify failed (${put.status}).`);

          const created = await shopifyGraphql(
            conn,
            `mutation($files: [FileCreateInput!]!) {
              fileCreate(files: $files) {
                files { id fileStatus alt ... on MediaImage { image { url } } ... on GenericFile { url } }
                userErrors { field message }
              }
            }`,
            { files: [{ originalSource: target.resourceUrl, contentType: isImage ? "IMAGE" : "FILE", alt }] },
            ctx.run.signal
          );
          const userErrors = collectUserErrors(created.data);
          const file = (created.data as { fileCreate?: { files?: Array<Record<string, unknown>> } } | null)?.fileCreate?.files?.[0];
          await audit(ctx, {
            operations: ["fileCreate"],
            scopes: ["write_files"],
            query: `upload:${filename}:${bytes.length}`,
            ids: file?.id ? [String(file.id)] : [],
            ok: !!file && userErrors.length === 0,
            error: userErrors.join("; ") || undefined,
            approvalId: approved.approvalId,
          });
          if (file) await markApplied(ctx, approved.approvalId);
          ctx.checkpoint();
          if (!file) return failure(`Shopify could not create the file: ${userErrors.join("; ") || "unknown error"}`);
          return text(
            JSON.stringify({
              fileId: file.id,
              status: file.fileStatus,
              url: (file.image as { url?: string } | undefined)?.url ?? file.url ?? null,
              note: "Shopify may still be processing the file (status UPLOADED/PROCESSING). It can be attached to a product right away.",
            })
          );
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

  };
}

function createSharedTools(ctx: ToolContext): Record<string, SDKCustomTool> {
  return {
    find_product_images: {
      description:
        "Search the web (Google Images) for real photos of a product, for example to give a product without images its photo. " +
        "Search by brand + model + key attribute. Returns candidate image URLs with size and source, saved as a gallery the user sees. " +
        (ctx.platform === "woocommerce"
          ? "To use one, add its URL to the product with woo_api (PUT products/{id} with images: [...current images as { id }, { src, alt }]; the first image is the main one). "
          : "To use one, attach its URL to the product with shopify_admin (productUpdate with media: [{ originalSource, mediaContentType: IMAGE, alt }]). ") +
        "Prefer official brand or retailer sources and images at least 800px wide. Do not use generateImage for real products.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms, e.g. 'Apple iPhone 17 Pro Max Cosmic Orange back'." },
          count: { type: "number", description: "Candidates to return (1-12, default 6)." },
        },
        required: ["query"],
      },
      execute: async (args) => {
        if (!ctx.serperApiKey) return failure("Image search is not configured on this server.");
        const query = String(args.query ?? "").trim().slice(0, 200);
        if (!query) return failure("Give search terms.");
        const count = Math.max(1, Math.min(12, Math.floor(Number(args.count) || 6)));
        try {
          const res = await fetch("https://google.serper.dev/images", {
            method: "POST",
            headers: { "X-API-KEY": ctx.serperApiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q: query, num: 20 }),
            signal: ctx.run.signal,
          });
          ctx.addCost(SERPER_USD_PER_QUERY, "image search");
          if (!res.ok) return failure(`Image search failed (${res.status}).`);
          const data = (await res.json()) as {
            images?: Array<{ title?: string; imageUrl?: string; imageWidth?: number; imageHeight?: number; source?: string; domain?: string; link?: string }>;
          };
          const candidates = (data.images ?? [])
            .filter((i) => i.imageUrl && /^https:\/\//.test(i.imageUrl) && !/\.(svg|gif)(\?|$)/i.test(i.imageUrl))
            .sort((a, b) => (b.imageWidth ?? 0) - (a.imageWidth ?? 0))
            .slice(0, count)
            .map((i) => ({
              image: i.imageUrl!,
              title: i.title ?? "",
              width: i.imageWidth ?? null,
              height: i.imageHeight ?? null,
              source: i.domain ?? i.source ?? "",
              page: i.link ?? "",
            }));
          if (!candidates.length) return text("No usable images found. Try other search terms (brand, exact model, colour).");
          const slug = query.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "images";
          const gallery = await writeChatFile(ctx, `images/search-${slug}.json`, JSON.stringify(candidates, null, 2), true);
          return text(JSON.stringify({ gallery, candidates }));
        } catch (error) {
          return failure((error as Error).message);
        }
      },
    },

    save_store_note: {
      description:
        "Remember something lasting about this store for every future chat: brand voice, the language for product text, naming or pricing rules, " +
        "things the user asked you to always or never do. Save only what the user stated or clearly confirmed, as one short line. " +
        "The user can see and edit these notes.",
      inputSchema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
      execute: async (args) => {
        const note = String(args.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
        if (!note) return failure("The note is empty.");
        const { data } = await ctx.db.from("store_agent_notes").select("content").eq("workspace_id", ctx.run.workspaceId).maybeSingle();
        const current = String(data?.content ?? "").trim();
        if (current.includes(note)) return text("Already noted.");
        const next = `${current ? `${current}\n` : ""}- ${note}`;
        if (next.length > 8000) return failure("The store notes are full. Ask the user to tidy them in Store notes.");
        const { error } = await ctx.db
          .from("store_agent_notes")
          .upsert({ workspace_id: ctx.run.workspaceId, content: next, updated_by: ctx.run.userId, updated_at: new Date().toISOString() });
        if (error) return failure(`Could not save the note: ${error.message}`);
        return text("Saved to the store notes. It applies to every future chat.");
      },
    },

    ask_user: {
      description:
        "Ask the user what you need to know, in one card, and wait for the answers. Ask only what you genuinely cannot decide well yourself " +
        "(which products, which tone, which of several options, what limit); as many questions as the task really needs, often just one. " +
        "Each question has short clickable options; the user can also type their own answer.",
      inputSchema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: MAX_QUESTIONS_PER_CARD,
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "The question, in the user's language." },
                options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
                multiple: { type: "boolean", description: "Allow choosing several options." },
              },
              required: ["question", "options"],
            },
          },
        },
        required: ["questions"],
      },
      execute: async (args) => {
        // Also accept a single top-level question.
        const raw = Array.isArray(args.questions) ? args.questions : [args];
        const questions = raw.slice(0, MAX_QUESTIONS_PER_CARD).map((q, i) => {
          const item = (q ?? {}) as Record<string, unknown>;
          return {
            id: `q${i + 1}`,
            text: String(item.question ?? "").trim(),
            options: Array.isArray(item.options) ? item.options.map(String).filter(Boolean).slice(0, 6) : [],
            multiple: item.multiple === true,
          };
        });
        if (!questions.length || questions.some((q) => !q.text || q.options.length < 2)) {
          return failure("Give every question its text and at least two options.");
        }
        await setChatStatus(ctx, "awaiting_answer");
        const { answer } = ctx.run.ask(questions);
        const answers = await answer;
        await setChatStatus(ctx, "running");
        if (!answers) {
          return failure(ctx.run.cancelled ? "The run was stopped." : "The user did not answer in time. Stop and say what you need from them.");
        }
        (ctx.consent ??= { declinedAt: null, answeredAt: null }).answeredAt = Date.now();
        return text(
          "The user answered:\n" +
            questions.map((q, i) => `${i + 1}. ${q.text}\n   → ${(answers[i] ?? []).join(" | ") || "(no answer)"}`).join("\n")
        );
      },
    },

    show_file: {
      description:
        "Open a file from your folder in the panel on the right of the user's screen: a report (.md), a table (.csv/.json), " +
        "a product gallery (.json array of objects with image/title/price), an image or a plan. Write the file first (write_file), then call this.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Path inside your folder." } },
        required: ["path"],
      },
      execute: async (args) => {
        let relative: string;
        try {
          const local = resolveInChat(ctx.files.cwd, String(args.path ?? ""));
          await fs.access(local);
          relative = path.relative(ctx.files.cwd, local).split(path.sep).join("/");
        } catch (error) {
          return failure((error as Error).message || `There is no file at ${args.path}.`);
        }
        try {
          await ctx.files.sync(ctx.run, new Set([relative]));
          return text(`Shown to the user: ${relative}`);
        } catch (error) {
          // The file is safe in the folder; only the upload to the panel failed.
          ctx.files.openWhenSynced(relative);
          ctx.log?.(`show_file upload deferred for ${relative}`, error);
          return text(
            `${relative} is saved. The connection to the user's screen is unstable, so it will open there automatically as soon as it recovers. ` +
              "Do not retry, convert or recreate the file; continue with the task."
          );
        }
      },
    },
  };
}

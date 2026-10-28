import { shopifyGraphql, type ShopifyConnection } from "./client";

/**
 * Shopify Bulk Operations: export a whole catalog in one query, or run one
 * mutation over thousands of records from a JSONL file. Both run on
 * Shopify's side; we start them, poll, and download the result.
 */

export type BulkStatus = "CREATED" | "RUNNING" | "COMPLETED" | "CANCELING" | "CANCELED" | "FAILED" | "EXPIRED";

export type BulkResult = {
  id: string;
  status: BulkStatus;
  errorCode: string | null;
  objectCount: number;
  /** Result JSONL (each line a record, or a mutation's answer with __lineNumber). */
  jsonl: string;
};

const POLL_MS = 2_500;
const MAX_WAIT_MS = 25 * 60 * 1000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("Cancelled"));
    });
  });

const NETWORK_RETRY_MS = [1_000, 3_000, 6_000, 10_000];

function isNetworkError(error: unknown): boolean {
  const e = error as { name?: string; message?: string; cause?: { code?: string } };
  return e?.name !== "AbortError" && /fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(`${e?.message} ${e?.cause?.code ?? ""}`);
}

/**
 * A bulk operation keeps running in Shopify while we wait, so a dropped
 * connection while polling or downloading its result is retried instead of
 * failing a change that has in fact been made.
 */
async function retryNetwork<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const delay = NETWORK_RETRY_MS[attempt];
      if (delay === undefined || signal?.aborted || !isNetworkError(error)) throw error;
      await sleep(delay, signal);
    }
  }
}

function userErrors(data: unknown, root: string): string[] {
  const errs = (data as Record<string, { userErrors?: Array<{ message: string }> }> | null)?.[root]?.userErrors ?? [];
  return errs.map((e) => e.message);
}

async function poll(conn: ShopifyConnection, id: string, signal?: AbortSignal, onProgress?: (count: number) => void): Promise<BulkResult> {
  const started = Date.now();
  for (;;) {
    const res = await retryNetwork(
      () =>
        shopifyGraphql(
          conn,
          `query($id: ID!) { node(id: $id) { ... on BulkOperation { id status errorCode objectCount url partialDataUrl } } }`,
          { id },
          signal
        ),
      signal
    );
    const op = (res.data as { node?: { status: BulkStatus; errorCode: string | null; objectCount: string; url: string | null; partialDataUrl: string | null } } | null)
      ?.node;
    if (!op) throw new Error("Shopify lost track of the bulk operation.");
    const count = Number(op.objectCount) || 0;
    onProgress?.(count);
    if (op.status === "COMPLETED" || op.status === "FAILED" || op.status === "CANCELED" || op.status === "EXPIRED") {
      const url = op.url ?? op.partialDataUrl;
      let jsonl = "";
      if (url) {
        jsonl = await retryNetwork(async () => {
          const file = await fetch(url, { signal });
          if (!file.ok) throw new Error(`Could not download the bulk result (${file.status}).`);
          return file.text();
        }, signal);
      }
      return { id, status: op.status, errorCode: op.errorCode, objectCount: count, jsonl };
    }
    if (Date.now() - started > MAX_WAIT_MS) throw new Error("The bulk operation is taking longer than 25 minutes; it keeps running in Shopify.");
    await sleep(POLL_MS, signal);
  }
}

/** Start a bulk export and wait for its JSONL. `query` is a plain query without pagination arguments. */
export async function runBulkQuery(
  conn: ShopifyConnection,
  query: string,
  signal?: AbortSignal,
  onProgress?: (count: number) => void
): Promise<BulkResult> {
  const res = await shopifyGraphql(
    conn,
    `mutation($query: String!) { bulkOperationRunQuery(query: $query) { bulkOperation { id status } userErrors { field message } } }`,
    { query },
    signal
  );
  const errors = [...(res.errors?.map((e) => e.message) ?? []), ...userErrors(res.data, "bulkOperationRunQuery")];
  const id = (res.data as { bulkOperationRunQuery?: { bulkOperation?: { id: string } } } | null)?.bulkOperationRunQuery?.bulkOperation?.id;
  if (!id) throw new Error(`Shopify did not start the export: ${errors.join("; ") || "unknown error"}`);
  return poll(conn, id, signal, onProgress);
}

/** Upload JSONL variables, run `mutation` once per line, wait for the answers. */
export async function runBulkMutation(
  conn: ShopifyConnection,
  mutation: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  signal?: AbortSignal,
  onProgress?: (count: number) => void
): Promise<BulkResult> {
  const jsonl = rows.map((r) => JSON.stringify(r)).join("\n");
  const staged = await shopifyGraphql(
    conn,
    `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`,
    { input: [{ resource: "BULK_MUTATION_VARIABLES", filename: "rows.jsonl", mimeType: "text/jsonl", httpMethod: "POST" }] },
    signal
  );
  const target = (staged.data as { stagedUploadsCreate?: { stagedTargets?: Array<{ url: string; parameters: Array<{ name: string; value: string }> }> } } | null)
    ?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error(`Shopify did not accept the upload: ${userErrors(staged.data, "stagedUploadsCreate").join("; ") || "no target"}`);
  const key = target.parameters.find((p) => p.name === "key")?.value;
  if (!key) throw new Error("Shopify's upload target has no key.");

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([jsonl], { type: "text/jsonl" }), "rows.jsonl");
  // The staged upload goes to the same target every time, so sending it again is safe.
  const upload = await retryNetwork(() => fetch(target.url, { method: "POST", body: form, signal }), signal);
  if (!upload.ok) throw new Error(`Uploading the changes to Shopify failed (${upload.status}).`);

  const run = await shopifyGraphql(
    conn,
    `mutation($mutation: String!, $path: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $path) { bulkOperation { id status } userErrors { field message } } }`,
    { mutation, path: key },
    signal
  );
  const errors = [...(run.errors?.map((e) => e.message) ?? []), ...userErrors(run.data, "bulkOperationRunMutation")];
  const id = (run.data as { bulkOperationRunMutation?: { bulkOperation?: { id: string } } } | null)?.bulkOperationRunMutation?.bulkOperation?.id;
  if (!id) throw new Error(`Shopify did not start the bulk change: ${errors.join("; ") || "unknown error"}`);
  return poll(conn, id, signal, onProgress);
}

/** Parse a bulk result: lines, and for mutations the userErrors per input line. */
export function parseBulkLines(jsonl: string): Array<Record<string, unknown>> {
  return jsonl
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

/** userErrors from a bulk mutation result, with the input line they belong to. */
export function bulkMutationErrors(lines: Array<Record<string, unknown>>): Array<{ line: number; message: string }> {
  const out: Array<{ line: number; message: string }> = [];
  for (const entry of lines) {
    const line = Number(entry.__lineNumber ?? -1);
    const data = entry.data as Record<string, { userErrors?: Array<{ message: string }> }> | undefined;
    for (const value of Object.values(data ?? {})) for (const e of value?.userErrors ?? []) out.push({ line, message: e.message });
    for (const e of (entry.errors as Array<{ message: string }> | undefined) ?? []) out.push({ line, message: e.message });
  }
  return out;
}

/** Flatten exported records into CSV: top-level records only; nested children are counted per parent. */
export function exportToCsv(lines: Array<Record<string, unknown>>): { csv: string; rows: number; columns: string[] } {
  const parents = lines.filter((l) => !l.__parentId);
  const childCounts = new Map<string, Map<string, number>>();
  for (const l of lines) {
    if (!l.__parentId) continue;
    const type = /^gid:\/\/shopify\/([A-Za-z0-9]+)\//.exec(String(l.id ?? ""))?.[1] ?? "child";
    const counts = childCounts.get(String(l.__parentId)) ?? new Map<string, number>();
    counts.set(type, (counts.get(type) ?? 0) + 1);
    childCounts.set(String(l.__parentId), counts);
  }
  const flat = parents.map((p) => {
    const row: Record<string, string> = {};
    const walk = (value: unknown, prefix: string) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, prefix ? `${prefix}.${k}` : k);
      } else row[prefix] = Array.isArray(value) ? value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ") : value == null ? "" : String(value);
    };
    walk(p, "");
    for (const [type, n] of childCounts.get(String(p.id)) ?? []) row[`${type} count`] = String(n);
    return row;
  });
  const columns = Array.from(new Set(flat.flatMap((r) => Object.keys(r))));
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [columns.map(cell).join(","), ...flat.map((r) => columns.map((c) => cell(r[c] ?? "")).join(","))].join("\n");
  return { csv, rows: flat.length, columns };
}

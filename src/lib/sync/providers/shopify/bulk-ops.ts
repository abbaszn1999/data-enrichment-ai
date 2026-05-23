// Shopify Bulk Operations helpers.
// - submitBulkQuery:    large reads without cost limits
// - submitBulkMutation: large writes (e.g. productSet) with JSONL upload
// - pollBulkOperation:  wait for finish (polls Shopify directly)
// - downloadJsonl:      stream result URL and yield parsed lines
//
// Refs:
//   https://shopify.dev/docs/api/usage/bulk-operations/queries
//   https://shopify.dev/docs/api/usage/bulk-operations/imports

import type { IntegrationRecord } from "@/lib/sync/core/types";
import { shopifyGraphQL } from "./graphql-client";
import { stageJsonlFile } from "./staged-upload";

export type BulkOperationStatus =
  | "CREATED"
  | "RUNNING"
  | "COMPLETED"
  | "CANCELED"
  | "CANCELING"
  | "FAILED"
  | "EXPIRED";

export type BulkOperationSnapshot = {
  id: string;
  status: BulkOperationStatus;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  objectCount: number | null;
  fileSize: number | null;
  url: string | null;
  partialDataUrl: string | null;
  rootObjectCount?: number | null;
  type: "QUERY" | "MUTATION" | null;
};

const BULK_OPERATION_RUN_QUERY = /* GraphQL */ `
  mutation BulkRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
        errorCode
        createdAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_RUN_MUTATION = /* GraphQL */ `
  mutation BulkRunMutation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(
      mutation: $mutation,
      stagedUploadPath: $stagedUploadPath
    ) {
      bulkOperation {
        id
        status
        errorCode
        createdAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
      userErrors { field message }
    }
  }
`;

// 2026-01+ supports `bulkOperation(id:)`; we use it since we pin 2026-04.
const BULK_OPERATION_BY_ID = /* GraphQL */ `
  query BulkOp($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
        rootObjectCount
        type
      }
    }
  }
`;

function toSnapshot(raw: unknown): BulkOperationSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    status: String(r.status ?? "CREATED") as BulkOperationStatus,
    errorCode: r.errorCode ? String(r.errorCode) : null,
    createdAt: String(r.createdAt ?? ""),
    completedAt: r.completedAt ? String(r.completedAt) : null,
    objectCount: r.objectCount != null ? Number(r.objectCount) : null,
    fileSize: r.fileSize != null ? Number(r.fileSize) : null,
    url: r.url ? String(r.url) : null,
    partialDataUrl: r.partialDataUrl ? String(r.partialDataUrl) : null,
    rootObjectCount: r.rootObjectCount != null ? Number(r.rootObjectCount) : null,
    type: (r.type as "QUERY" | "MUTATION" | undefined) ?? null,
  };
}

export async function submitBulkQuery(params: {
  integration: IntegrationRecord;
  query: string;
}): Promise<BulkOperationSnapshot> {
  const res = await shopifyGraphQL<{
    bulkOperationRunQuery: {
      bulkOperation: unknown;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>({
    integration: params.integration,
    query: BULK_OPERATION_RUN_QUERY,
    variables: { query: params.query },
    options: { estimatedCost: 11, tag: "bulkOperationRunQuery" },
  });
  if (res.errors.length > 0) throw new Error(`bulkOperationRunQuery: ${res.errors[0].message}`);
  const payload = res.data?.bulkOperationRunQuery;
  if (!payload) throw new Error("bulkOperationRunQuery returned no payload");
  if (payload.userErrors.length > 0) {
    throw new Error(`bulkOperationRunQuery userError: ${payload.userErrors[0].message}`);
  }
  return toSnapshot(payload.bulkOperation);
}

export async function submitBulkMutation(params: {
  integration: IntegrationRecord;
  mutation: string;
  /** JSONL file content — each line is a `{ input, ... }` object for the mutation. */
  jsonlContent: string;
  filename?: string;
}): Promise<BulkOperationSnapshot> {
  const { stagedUploadPath } = await stageJsonlFile({
    integration: params.integration,
    jsonlContent: params.jsonlContent,
    filename: params.filename,
  });

  const res = await shopifyGraphQL<{
    bulkOperationRunMutation: {
      bulkOperation: unknown;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>({
    integration: params.integration,
    query: BULK_OPERATION_RUN_MUTATION,
    variables: { mutation: params.mutation, stagedUploadPath },
    options: { estimatedCost: 11, tag: "bulkOperationRunMutation" },
  });

  if (res.errors.length > 0) throw new Error(`bulkOperationRunMutation: ${res.errors[0].message}`);
  const payload = res.data?.bulkOperationRunMutation;
  if (!payload) throw new Error("bulkOperationRunMutation returned no payload");
  if (payload.userErrors.length > 0) {
    throw new Error(`bulkOperationRunMutation userError: ${payload.userErrors[0].message}`);
  }
  return toSnapshot(payload.bulkOperation);
}

export async function getBulkOperation(params: {
  integration: IntegrationRecord;
  bulkOperationId: string;
}): Promise<BulkOperationSnapshot> {
  const res = await shopifyGraphQL<{ node: unknown }>({
    integration: params.integration,
    query: BULK_OPERATION_BY_ID,
    variables: { id: params.bulkOperationId },
    options: { estimatedCost: 2, tag: "bulkOperation(id)" },
  });
  if (res.errors.length > 0) throw new Error(`bulkOperation: ${res.errors[0].message}`);
  return toSnapshot(res.data?.node);
}

/** Poll until bulk op finishes. Default: 5s interval, 10min ceiling (adjust as needed). */
export async function pollBulkOperation(params: {
  integration: IntegrationRecord;
  bulkOperationId: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (snap: BulkOperationSnapshot) => void;
}): Promise<BulkOperationSnapshot> {
  const intervalMs = params.intervalMs ?? 5_000;
  const timeoutMs = params.timeoutMs ?? 10 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (params.signal?.aborted) throw new Error("pollBulkOperation aborted");

    const snap = await getBulkOperation({
      integration: params.integration,
      bulkOperationId: params.bulkOperationId,
    });
    params.onProgress?.(snap);

    if (
      snap.status === "COMPLETED" ||
      snap.status === "FAILED" ||
      snap.status === "CANCELED" ||
      snap.status === "EXPIRED"
    ) {
      return snap;
    }
    if (Date.now() > deadline) {
      throw new Error(`pollBulkOperation timed out (status=${snap.status})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Stream JSONL from a bulk result URL, yielding one parsed object per line. */
export async function* streamBulkJsonl<T = unknown>(
  url: string,
  signal?: AbortSignal
): AsyncGenerator<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`streamBulkJsonl HTTP ${res.status}`);
  }
  if (!res.body) {
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      yield JSON.parse(line) as T;
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        try {
          yield JSON.parse(line) as T;
        } catch {
          // Skip malformed line; Shopify shouldn't emit these but be defensive.
        }
      }
    }
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer) as T;
      } catch {
        /* ignore */
      }
    }
  } finally {
    reader.releaseLock();
  }
}

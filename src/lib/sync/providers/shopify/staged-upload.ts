// Staged uploads helper for Shopify GraphQL Admin API.
// Used by:
//   - Bulk mutations (upload JSONL variables file)
//   - Product media (if we need large file uploads; small images can use direct URL)
//
// Flow (verified against shopify.dev/mutations/stagedUploadsCreate):
//   1. stagedUploadsCreate(input) → returns {url, resourceUrl, parameters}
//   2. POST multipart/form-data to `url` with `parameters` + file bytes
//   3. Pass resourceUrl as originalSource to downstream mutation

import type { IntegrationRecord } from "@/lib/sync/core/types";
import { shopifyGraphQL } from "./graphql-client";

type StagedUploadResource =
  | "BULK_MUTATION_VARIABLES"
  | "IMAGE"
  | "VIDEO"
  | "MODEL_3D"
  | "FILE";

type StagedUploadHttpMethod = "POST" | "PUT";

const STAGED_UPLOADS_CREATE = /* GraphQL */ `
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export type StagedTarget = {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
};

export async function createStagedUpload(params: {
  integration: IntegrationRecord;
  filename: string;
  mimeType: string;
  resource: StagedUploadResource;
  httpMethod?: StagedUploadHttpMethod;
  fileSizeBytes?: number;
}): Promise<StagedTarget> {
  const { integration, filename, mimeType, resource, httpMethod, fileSizeBytes } = params;

  const input: Record<string, unknown> = {
    filename,
    mimeType,
    resource,
    httpMethod: httpMethod ?? "POST",
  };
  if (fileSizeBytes != null) input.fileSize = String(fileSizeBytes);

  const res = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[];
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>({
    integration,
    query: STAGED_UPLOADS_CREATE,
    variables: { input: [input] },
    options: { estimatedCost: 11, tag: "stagedUploadsCreate" },
  });

  if (res.errors.length > 0) {
    throw new Error(`stagedUploadsCreate failed: ${res.errors[0].message}`);
  }
  const payload = res.data?.stagedUploadsCreate;
  if (!payload || payload.userErrors.length > 0) {
    const msg = payload?.userErrors?.[0]?.message ?? "Unknown error";
    throw new Error(`stagedUploadsCreate userError: ${msg}`);
  }
  const target = payload.stagedTargets[0];
  if (!target) throw new Error("stagedUploadsCreate returned no target");
  return target;
}

/**
 * POST the file bytes to the staged target URL using multipart/form-data.
 * `parameters` must be prepended in order before the `file` field per Shopify spec.
 */
export async function uploadToStagedTarget(
  target: StagedTarget,
  fileBytes: Uint8Array | Blob,
  contentType: string
): Promise<void> {
  const form = new FormData();
  for (const p of target.parameters) {
    form.append(p.name, p.value);
  }
  const blob =
    fileBytes instanceof Blob
      ? fileBytes
      : new Blob([fileBytes as BlobPart], { type: contentType });
  form.append("file", blob);

  const res = await fetch(target.url, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Staged upload POST failed (${res.status})${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
}

/** High-level: stage + upload a JSONL file for bulk mutation. Returns the resourceUrl path to pass to bulkOperationRunMutation. */
export async function stageJsonlFile(params: {
  integration: IntegrationRecord;
  jsonlContent: string;
  filename?: string;
}): Promise<{ stagedUploadPath: string; resourceUrl: string }> {
  const filename = params.filename ?? "bulk-variables.jsonl";
  const mimeType = "text/jsonl";
  const bytes = new TextEncoder().encode(params.jsonlContent);

  const target = await createStagedUpload({
    integration: params.integration,
    filename,
    mimeType,
    resource: "BULK_MUTATION_VARIABLES",
    httpMethod: "POST",
    fileSizeBytes: bytes.byteLength,
  });

  await uploadToStagedTarget(target, bytes, mimeType);

  // The bulkOperationRunMutation expects the staged upload path — Shopify uses
  // the `key` parameter from `parameters`. Extract it; otherwise fall back to resourceUrl.
  const keyParam = target.parameters.find((p) => p.name === "key")?.value;
  return {
    stagedUploadPath: keyParam ?? target.resourceUrl,
    resourceUrl: target.resourceUrl,
  };
}

import { NextRequest, NextResponse } from "next/server";
import {
  embeddingsProductsBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  loadProjectProducts,
  loadEmbeddingsManifestAdmin,
  appendEmbeddingsShardAdmin,
  type EmbeddingShardItem,
} from "@/lib/market-research/storage-admin";
import {
  contentHash,
  embedTexts,
  embeddingsAvailable,
  encodeVectorInt8,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from "@/lib/market-research/agent/embeddings";
import { buildUnifiedProductText } from "@/lib/market-research/agent/stage5-collection-clusterer";
import { runWithConcurrency, chunk } from "@/lib/sync/core/batch-executor";

export const maxDuration = 60;

// One HTTP call embeds one page of products for the collections behind the
// terms the customer selected in Tab 3. A page is chunked into OpenAI
// batches of 256 (its hard per-request cap) sent 5 at a time, well inside
// the route's time budget even for a couple thousand products a page.
const PAGE_SIZE = 2_000;
const OPENAI_BATCH_SIZE = 256;
const EMBED_CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = embeddingsProductsBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid embeddings payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    if (!embeddingsAvailable()) {
      // No OpenAI key configured: Stage 5 falls back to lexical cosine, so
      // this pass is a no-op rather than a hard failure.
      return NextResponse.json(
        { offset: 0, nextOffset: 0, done: true, processed: 0, embedded: 0, skipped: 0, total: 0 },
        { headers: auth.headers }
      );
    }

    const collectionIdSet = new Set(parsed.data.collectionIds);
    const allProducts = await loadProjectProducts(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId
    );
    const scoped = allProducts.filter((p) =>
      p.collectionIds.some((cid) => collectionIdSet.has(cid))
    );

    const total = scoped.length;
    const offset = Math.min(parsed.data.offset, total);
    const page = scoped.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + page.length;
    const done = nextOffset >= total;

    const manifest = await loadEmbeddingsManifestAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "products"
    );
    const knownHashes = manifest?.hashes ?? {};

    const toEmbed: Array<{ id: string; hash: string; text: string }> = [];
    let skipped = 0;
    for (const p of page) {
      const text = buildUnifiedProductText(p);
      const hash = contentHash(text);
      if (knownHashes[p.id] === hash) {
        skipped += 1;
        continue;
      }
      toEmbed.push({ id: p.id, hash, text });
    }

    const items: EmbeddingShardItem[] = [];
    if (toEmbed.length > 0) {
      const batches = chunk(toEmbed, OPENAI_BATCH_SIZE);
      const batchRun = await runWithConcurrency(
        batches,
        async (batch) => {
          const vectors = await embedTexts(batch.map((b) => b.text));
          return batch.map((b, i) => ({ meta: b, vector: vectors[i] }));
        },
        { concurrency: EMBED_CONCURRENCY }
      );
      for (const rows of batchRun.successes) {
        for (const { meta, vector } of rows) {
          // A null vector means this text failed to embed (rate limit, API
          // error) — leave it out of the shard so it's retried on the next
          // pass rather than being persisted as if it had no match.
          if (!vector) continue;
          items.push({ id: meta.id, hash: meta.hash, vector: encodeVectorInt8(vector) });
        }
      }
      if (batchRun.errors.length > 0) {
        console.error(
          `[embeddings/products] ${batchRun.errors.length}/${batches.length} batches failed, will retry on next pass`
        );
      }
    }

    if (items.length > 0) {
      await appendEmbeddingsShardAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "products",
        items,
        EMBEDDING_MODEL,
        EMBEDDING_DIMENSIONS
      );
    }

    return NextResponse.json(
      {
        offset,
        nextOffset,
        done,
        processed: page.length,
        embedded: items.length,
        skipped,
        total,
      },
      { headers: auth.headers }
    );
  } catch (err) {
    console.error("[api/market-research/embeddings/products] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to embed products";
    return jsonError(msg, 500);
  }
}

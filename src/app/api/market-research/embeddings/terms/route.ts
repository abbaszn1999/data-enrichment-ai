import { NextRequest, NextResponse } from "next/server";
import {
  embeddingsTermsBodySchema,
  jsonError,
  requireMrWrite,
} from "@/lib/market-research/api-schema";
import {
  loadClassifiedCategoryTerms,
  loadEmbeddingsManifestAdmin,
  appendEmbeddingsShardAdmin,
  loadProjectSliceAdmin,
  loadExtractRowsAdmin,
  type EmbeddingShardItem,
} from "@/lib/market-research/storage-admin";
import {
  archiveRowsByPhrase,
  filterClassifiedTerms,
} from "@/lib/market-research/sheet-filters";
import { normalizeKeywordFilters } from "@/components/market-research/workspace-data";
import {
  contentHash,
  embedTexts,
  embeddingsAvailable,
  encodeVectorInt8,
  termEmbedText,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
} from "@/lib/market-research/agent/embeddings";
import { runWithConcurrency, chunk } from "@/lib/sync/core/batch-executor";
import type { MockSeedRow } from "@/components/market-research/mock-data";

export const maxDuration = 60;

// A term is embedded as the bare phrase. Collection lineage is a later
// deterministic scope filter in `stage5-collection-clusterer.ts`, not part
// of the vector text.
const PAGE_SIZE = 2_000;
const OPENAI_BATCH_SIZE = 256;
const EMBED_CONCURRENCY = 5;

type SeedsSlicePayload = { seedRows: MockSeedRow[]; manualSeeds: MockSeedRow[] };

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = embeddingsTermsBodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid embeddings payload", 400);
  }

  const auth = await requireMrWrite(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    if (!embeddingsAvailable()) {
      return NextResponse.json(
        { offset: 0, nextOffset: 0, done: true, processed: 0, embedded: 0, skipped: 0, total: 0 },
        { headers: auth.headers }
      );
    }

    const [terms, seedsSlice, archiveRows] = await Promise.all([
      loadClassifiedCategoryTerms(auth.admin, parsed.data.workspaceId, parsed.data.projectId),
      loadProjectSliceAdmin<SeedsSlicePayload>(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "seeds"
      ).catch(() => null),
      loadExtractRowsAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId
      ).catch(() => []),
    ]);

    const seedRowById = new Map<string, MockSeedRow>();
    for (const row of [...(seedsSlice?.seedRows ?? []), ...(seedsSlice?.manualSeeds ?? [])]) {
      seedRowById.set(row.id, row);
    }

    const surviving = filterClassifiedTerms(
      terms,
      archiveRowsByPhrase(archiveRows),
      normalizeKeywordFilters(parsed.data.filters)
    );
    const total = surviving.length;
    const offset = Math.min(parsed.data.offset, total);
    const page = surviving.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + page.length;
    const done = nextOffset >= total;

    const manifest = await loadEmbeddingsManifestAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      "terms"
    );
    const knownHashes = manifest?.hashes ?? {};

    const toEmbed: Array<{ id: string; hash: string; text: string; collectionId: string }> = [];
    let skipped = 0;
    for (const term of page) {
      const seedRow = seedRowById.get(term.seedId);
      const collectionId = seedRow?.collectionId ?? "";
      if (!collectionId) {
        // Can't scope this term to a collection — Stage 5 Phase 1's exact
        // lineage lookup needs it, so there is nothing safe to embed it
        // against. Leave it out; it will fall back to lexical scoring.
        skipped += 1;
        continue;
      }
      const text = termEmbedText(term.keyword);
      const hash = contentHash(text);
      if (!text || knownHashes[term.id] === hash) {
        skipped += 1;
        continue;
      }
      toEmbed.push({ id: term.id, hash, text, collectionId });
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
          if (!vector) continue;
          items.push({
            id: meta.id,
            hash: meta.hash,
            vector: encodeVectorInt8(vector),
            collectionId: meta.collectionId,
          });
        }
      }
      if (batchRun.errors.length > 0) {
        console.error(
          `[embeddings/terms] ${batchRun.errors.length}/${batches.length} batches failed, will retry on next pass`
        );
      }
    }

    if (items.length > 0) {
      await appendEmbeddingsShardAdmin(
        auth.admin,
        parsed.data.workspaceId,
        parsed.data.projectId,
        "terms",
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
    console.error("[api/market-research/embeddings/terms] Error:", err);
    const msg = err instanceof Error ? err.message : "Failed to embed terms";
    return jsonError(msg, 500);
  }
}

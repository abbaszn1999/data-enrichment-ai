import type { LocalAgentDocument, LocalAgentRunDocument, LocalAgentRunEventDocument } from "@cursor/sdk";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentStoreBackend } from "./write-behind-store";

export const AGENT_STORE_BUCKET = "agent-store";

const ROW_CHUNK = 500;
const REMOVE_CHUNK = 100;
const BLOB_TABLE = "agent_store_blobs";
/** Rows per page when loading a chat's blobs (about 5 KB each). */
const BLOB_PAGE = 400;
const BLOB_BATCH_BYTES = 2 * 1024 * 1024;
const LEGACY_PARALLEL = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each chat's agent runs in `{workRoot}/{workspaceId}/{chatId}`, so the
 * workspace is the second-to-last path segment of the agent's `cwd`.
 */
export function workspaceIdFromCwd(cwd: string): string | null {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  const candidate = parts[parts.length - 2];
  return candidate && UUID.test(candidate) ? candidate.toLowerCase() : null;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

const blobPath = (agentId: string, blobId: string) => `${agentId}/${blobId}`;

/** Agent state, runs, events and checkpoint blobs in Postgres (agent_store_* tables). */
export class SupabaseAgentStoreBackend implements AgentStoreBackend {
  constructor(private readonly db: SupabaseClient) {}

  async loadAgent(agentId: string): Promise<LocalAgentDocument | null> {
    const data = check(
      await this.db.from("agent_store_agents").select("doc").eq("agent_id", agentId).maybeSingle(),
      "load agent"
    );
    return (data?.doc as LocalAgentDocument | undefined) ?? null;
  }

  async listAgents(filter: { cwd?: string; limit: number; afterUpdatedAt?: number }): Promise<LocalAgentDocument[]> {
    let query = this.db.from("agent_store_agents").select("doc").order("updated_at", { ascending: false }).limit(filter.limit);
    if (filter.cwd) query = query.eq("cwd", filter.cwd);
    if (filter.afterUpdatedAt !== undefined) query = query.lte("updated_at", filter.afterUpdatedAt);
    const data = check(await query, "list agents");
    return (data ?? []).map((row) => row.doc as LocalAgentDocument);
  }

  async saveAgents(agents: readonly LocalAgentDocument[]): Promise<void> {
    for (const part of chunks(agents, ROW_CHUNK)) {
      check(
        await this.db.from("agent_store_agents").upsert(
          part.map((doc) => ({
            agent_id: doc.agentId,
            workspace_id: workspaceIdFromCwd(doc.cwd),
            cwd: doc.cwd,
            doc,
            updated_at: doc.updatedAt,
          }))
        ),
        "save agents"
      );
    }
  }

  async deleteAgents(agentIds: readonly string[]): Promise<void> {
    for (const part of chunks(agentIds, ROW_CHUNK)) {
      check(await this.db.from("agent_store_agents").delete().in("agent_id", part), "delete agents");
    }
  }

  async loadRuns(agentId: string): Promise<LocalAgentRunDocument[]> {
    const data = check(
      await this.db.from("agent_store_runs").select("doc").eq("agent_id", agentId).order("turn_number").order("run_id"),
      "load runs"
    );
    return (data ?? []).map((row) => row.doc as LocalAgentRunDocument);
  }

  async saveRuns(runs: readonly LocalAgentRunDocument[]): Promise<void> {
    for (const part of chunks(runs, ROW_CHUNK)) {
      check(
        await this.db.from("agent_store_runs").upsert(
          part.map((doc) => ({ run_id: doc.runId, agent_id: doc.agentId, turn_number: doc.turnNumber, doc }))
        ),
        "save runs"
      );
    }
  }

  async deleteRuns(runIds: readonly string[]): Promise<void> {
    for (const part of chunks(runIds, ROW_CHUNK)) {
      check(await this.db.from("agent_store_runs").delete().in("run_id", part), "delete runs");
    }
  }

  async lastEventSeq(runId: string): Promise<number> {
    const data = check(
      await this.db
        .from("agent_store_run_events")
        .select("seq")
        .eq("run_id", runId)
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "last event seq"
    );
    return (data?.seq as number | undefined) ?? 0;
  }

  async loadEvents(runId: string, afterSeq: number, limit: number): Promise<LocalAgentRunEventDocument[]> {
    const data = check(
      await this.db
        .from("agent_store_run_events")
        .select("run_id, seq, event_type, payload, payload_ref, idempotency_key, created_at")
        .eq("run_id", runId)
        .gt("seq", afterSeq)
        .order("seq")
        .limit(limit),
      "load events"
    );
    return (data ?? []).map((row) => ({
      runId: row.run_id as string,
      seq: row.seq as number,
      offset: String(row.seq),
      eventType: row.event_type as string,
      payload: row.payload,
      payloadRef: (row.payload_ref as string | null) ?? null,
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      createdAt: Number(row.created_at),
    }));
  }

  async saveEvents(events: readonly LocalAgentRunEventDocument[]): Promise<void> {
    for (const part of chunks(events, ROW_CHUNK)) {
      check(
        await this.db.from("agent_store_run_events").upsert(
          part.map((e) => ({
            run_id: e.runId,
            seq: e.seq,
            event_type: e.eventType,
            payload: e.payload ?? null,
            payload_ref: e.payloadRef,
            idempotency_key: e.idempotencyKey,
            created_at: e.createdAt,
          })),
          { onConflict: "run_id,seq", ignoreDuplicates: true }
        ),
        "save events"
      );
    }
  }

  async deleteEvents(runIds: readonly string[]): Promise<void> {
    for (const part of chunks(runIds, ROW_CHUNK)) {
      check(await this.db.from("agent_store_run_events").delete().in("run_id", part), "delete events");
    }
  }

  // Blobs live in the agent_store_blobs table (base64). Older chats still have
  // theirs in the agent-store bucket: reads fall back to it, and the first
  // full load of such a chat moves its blobs into the table.

  async loadBlob(agentId: string, blobId: string): Promise<Uint8Array | null> {
    const row = check(
      await this.db.from(BLOB_TABLE).select("data").eq("agent_id", agentId).eq("blob_id", blobId).maybeSingle(),
      "load blob"
    );
    if (row) return fromBase64(row.data as string);
    const { data, error } = await this.db.storage.from(AGENT_STORE_BUCKET).download(blobPath(agentId, blobId));
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async loadAllBlobs(agentId: string): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    for (let from = 0; ; from += BLOB_PAGE) {
      const rows = check(
        await this.db.from(BLOB_TABLE).select("blob_id, data").eq("agent_id", agentId).order("blob_id").range(from, from + BLOB_PAGE - 1),
        "load blobs"
      );
      for (const row of rows ?? []) out.set(row.blob_id as string, fromBase64(row.data as string));
      if (!rows || rows.length < BLOB_PAGE) break;
    }
    if (out.size) return out;

    // A chat from before the table: bring its blobs over once.
    const legacy = await this.listStorageBlobs(agentId);
    if (!legacy.length) return out;
    for (const part of chunks(legacy, LEGACY_PARALLEL)) {
      await Promise.all(
        part.map(async (blobId) => {
          const { data } = await this.db.storage.from(AGENT_STORE_BUCKET).download(blobPath(agentId, blobId));
          if (data) out.set(blobId, new Uint8Array(await data.arrayBuffer()));
        })
      );
    }
    await this.saveBlobs([...out].map(([blobId, data]) => ({ agentId, blobId, data })));
    await this.removeStorageBlobs(agentId, legacy).catch(() => undefined);
    return out;
  }

  async saveBlobs(blobs: ReadonlyArray<{ agentId: string; blobId: string; data: Uint8Array }>): Promise<void> {
    // Batches of about 2 MB, so a long turn's checkpoints go in a few requests.
    let batch: Array<Record<string, unknown>> = [];
    let bytes = 0;
    const send = async () => {
      if (!batch.length) return;
      check(await this.db.from(BLOB_TABLE).upsert(batch, { onConflict: "agent_id,blob_id" }), "save blobs");
      batch = [];
      bytes = 0;
    };
    for (const b of blobs) {
      batch.push({ agent_id: b.agentId, blob_id: b.blobId, data: toStored(b.data), size: b.data.byteLength });
      bytes += b.data.byteLength;
      if (bytes >= BLOB_BATCH_BYTES || batch.length >= ROW_CHUNK) await send();
    }
    await send();
  }

  async listBlobs(agentId: string): Promise<string[]> {
    const ids = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const rows = check(
        await this.db.from(BLOB_TABLE).select("blob_id").eq("agent_id", agentId).order("blob_id").range(from, from + 999),
        "list blobs"
      );
      for (const row of rows ?? []) ids.add(row.blob_id as string);
      if (!rows || rows.length < 1000) break;
    }
    for (const id of await this.listStorageBlobs(agentId)) ids.add(id);
    return [...ids];
  }

  async deleteBlobs(agentId: string, blobIds: readonly string[]): Promise<void> {
    for (const part of chunks(blobIds, ROW_CHUNK)) {
      check(await this.db.from(BLOB_TABLE).delete().eq("agent_id", agentId).in("blob_id", part), "delete blobs");
    }
    await this.removeStorageBlobs(agentId, blobIds);
  }

  private async listStorageBlobs(agentId: string): Promise<string[]> {
    const ids: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.db.storage.from(AGENT_STORE_BUCKET).list(agentId, { limit: 1000, offset });
      if (error) throw new Error(`list blobs: ${error.message}`);
      for (const item of data ?? []) ids.push(item.name);
      if (!data || data.length < 1000) break;
    }
    return ids;
  }

  private async removeStorageBlobs(agentId: string, blobIds: readonly string[]): Promise<void> {
    for (const part of chunks(blobIds, REMOVE_CHUNK)) {
      const { error } = await this.db.storage.from(AGENT_STORE_BUCKET).remove(part.map((id) => blobPath(agentId, id)));
      if (error) throw new Error(`delete blobs: ${error.message}`);
    }
  }
}

/**
 * Blobs are stored gzip-compressed, then base64 ("gz:" prefix): about 40% less
 * to send each time a chat is resumed. Plain base64 rows still read as before.
 */
const GZIP_PREFIX = "gz:";

function toStored(data: Uint8Array): string {
  return GZIP_PREFIX + gzipSync(data).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  const buf = value.startsWith(GZIP_PREFIX) ? gunzipSync(Buffer.from(value.slice(GZIP_PREFIX.length), "base64")) : Buffer.from(value, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

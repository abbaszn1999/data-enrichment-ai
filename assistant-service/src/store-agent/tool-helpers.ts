import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChatFiles, resolveInChat } from "./files";
import type { StoreAgentRun } from "./run";
import type { ShopifyConnection } from "./shopify/client";
import type { OperationRisk } from "./shopify/scopes";
import { isUndoable, previewCsv, previewFromSnapshots, type Backup, type Snapshot } from "./shopify/snapshot";
import type { StorePlatform } from "./store-connection";
import type { WooConnection } from "./woocommerce/client";

export type ToolContext = {
  db: SupabaseClient;
  run: StoreAgentRun;
  files: ChatFiles;
  /** The platform of the connected store; only its tools are given to the agent. */
  platform: StorePlatform;
  connection: () => Promise<ShopifyConnection>;
  woo: () => Promise<WooConnection>;
  autoRun: boolean;
  /** Auto-run also applies bulk changes (the user is the owner or an admin). */
  autoRunBulk: boolean;
  /** Plan mode: the store must not change, whatever the model tries. */
  planMode: boolean;
  /**
   * When the user last declined a change and last answered a question in this
   * run. After a decline, deletes wait until the user has answered again, so
   * a "no" is never followed straight away by a bigger delete.
   */
  consent?: { declinedAt: number | null; answeredAt: number | null };
  /** Persist state now (a store write happened). */
  checkpoint: () => void;
  /** Cost of a paid call outside the model (image search), added to the run. */
  addCost: (usd: number, label: string) => void;
  serperApiKey?: string;
  log?: (message: string, extra?: unknown) => void;
};

/** Results longer than this go to a file the agent can read in parts. */
const MAX_INLINE_RESULT = 40_000;
/** Changes to more records than this are bulk changes: owners and admins approve them. */
export const BULK_MIN_RECORDS = 26;
export const MAX_BULK_ROWS = 50_000;
/** Records read back for preview and undo. */
export const MAX_SNAPSHOT = 5_000;

export const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
export const failure = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: true as const });
export const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

export async function setChatStatus(ctx: ToolContext, status: "running" | "awaiting_approval" | "awaiting_answer") {
  await ctx.db.from("store_agent_chats").update({ status, updated_at: new Date().toISOString() }).eq("id", ctx.run.chatId);
}

type Approved = { ok: true; approvalId: string; records: Snapshot[]; undo: string } | { ok: false; message: string };

/** Told to the agent with every applied change, so it never promises an undo that does not exist. */
const UNDO_AVAILABLE = "The user can undo this change from its approval card.";
const UNDO_UNAVAILABLE = "This change cannot be undone automatically (only edits to fields of existing records can). Do not offer an undo for it.";

/**
 * Every store change goes through here: read the current values of what it
 * touches, show before → after (in full in the panel when it is large), ask
 * the user unless Auto-run covers it, and keep a backup so it can be undone.
 * Deletes always ask, since they cannot be undone; bulk changes run on their
 * own only for users who may approve them.
 */
export async function approveWrite(
  ctx: ToolContext,
  plan: {
    risk: Exclude<OperationRisk, "read">;
    summary: string;
    operations: string[];
    rows: number;
    /** Reads the current values of the records the change touches. */
    snapshot?: () => Promise<Snapshot[]>;
  }
): Promise<Approved> {
  if (ctx.planMode) {
    return {
      ok: false,
      message: "Plan mode is on, so nothing in the store can change. Put this step in the plan; the user switches to Agent mode to carry it out.",
    };
  }
  const consent = (ctx.consent ??= { declinedAt: null, answeredAt: null });
  if (plan.risk === "delete" && consent.declinedAt !== null && (consent.answeredAt ?? 0) <= consent.declinedAt) {
    return {
      ok: false,
      message:
        "The user declined a change a moment ago, so no deletion can be proposed now. Do not try another one: ask the user with ask_user " +
        "what they want (for example a smaller deletion, a backup export first, or nothing), and only continue with their answer.",
    };
  }
  let records: Snapshot[] = [];
  if (plan.snapshot) {
    try {
      records = await plan.snapshot();
    } catch (error) {
      ctx.log?.("snapshot failed", error);
    }
  }

  let previewFileId: string | null = null;
  if (records.length > 3) {
    try {
      previewFileId = await ctx.files.store(`previews/changes-${stamp()}.csv`, Buffer.from(previewCsv(records)), "agent", ctx.run.id);
      ctx.run.emit({ type: "file", fileId: previewFileId, name: "previews/changes.csv", kind: "csv", mime: "text/csv", open: true });
    } catch (error) {
      ctx.log?.("full preview failed", error);
    }
  }

  const preview = previewFromSnapshots(records);
  const { data, error } = await ctx.db
    .from("store_agent_approvals")
    .insert({
      chat_id: ctx.run.chatId,
      workspace_id: ctx.run.workspaceId,
      run_id: ctx.run.id,
      kind: plan.risk,
      summary: plan.summary.slice(0, 2000),
      operations: plan.operations,
      preview,
      preview_file_id: previewFileId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: `Could not record the change for approval (${error?.message ?? "no row"}). Do not make this change.` };
  const approvalId = data.id as string;

  ctx.run.emit({
    type: "approval",
    approvalId,
    risk: plan.risk,
    summary: plan.summary,
    operations: plan.operations,
    preview,
    previewFileId: previewFileId ?? undefined,
    records: plan.rows,
  });

  const auto = ctx.autoRun && (plan.risk === "write" || (plan.risk === "bulk" && ctx.autoRunBulk));
  let outcome: "approved" | "rejected" | "expired" = "approved";
  if (!auto) {
    await setChatStatus(ctx, "awaiting_approval");
    outcome = await ctx.run.waitForApproval(approvalId);
    await setChatStatus(ctx, "running");
  }
  const undoable = outcome === "approved" && isUndoable(records);
  let backupPath: string | null = null;
  if (undoable) {
    const backup: Backup = { version: 1, platform: ctx.platform, createdAt: new Date().toISOString(), operations: plan.operations, records };
    try {
      const relative = `backups/${approvalId}.json`;
      await ctx.files.store(relative, Buffer.from(JSON.stringify(backup)), "agent", ctx.run.id);
      backupPath = ctx.files.storagePath(relative);
    } catch (e) {
      ctx.log?.("saving the backup failed", e);
    }
  }
  await ctx.db
    .from("store_agent_approvals")
    .update({
      status: outcome,
      decided_by: outcome === "expired" ? null : ctx.run.userId,
      decided_at: new Date().toISOString(),
      backup_path: backupPath,
      undoable: !!backupPath,
    })
    .eq("id", approvalId);
  ctx.run.emit({ type: "approval_resolved", approvalId, status: outcome, auto, undoable: !!backupPath });

  if (outcome === "approved") return { ok: true, approvalId, records, undo: backupPath ? UNDO_AVAILABLE : UNDO_UNAVAILABLE };
  if (outcome === "rejected") consent.declinedAt = Date.now();
  if (ctx.run.cancelled) return { ok: false, message: "The run was stopped." };
  return {
    ok: false,
    message:
      outcome === "expired"
        ? "Nobody approved this change in time, so it was not made. Tell the user it is waiting for them and stop."
        : "The user declined this change, so it was not made. Do not try it again; ask what they would like instead.",
  };
}

export async function markApplied(ctx: ToolContext, approvalId: string) {
  await ctx.db.from("store_agent_approvals").update({ applied_at: new Date().toISOString() }).eq("id", approvalId);
}

export async function audit(
  ctx: ToolContext,
  entry: { operations: string[]; scopes: string[]; query: string; ids: string[]; ok: boolean; error?: string; approvalId?: string }
) {
  const { error } = await ctx.db.from("store_agent_audit_log").insert({
    workspace_id: ctx.run.workspaceId,
    chat_id: ctx.run.chatId,
    run_id: ctx.run.id,
    user_id: ctx.run.userId,
    approval_id: entry.approvalId ?? null,
    operation: entry.operations.join(", ").slice(0, 500),
    scope: entry.scopes.join(", ") || "none",
    query_hash: createHash("sha256").update(entry.query).digest("hex"),
    affected_ids: entry.ids.slice(0, 500),
    ok: entry.ok,
    error: entry.error?.slice(0, 2000) ?? null,
  });
  if (error) ctx.log?.("audit log write failed", error.message);
}

/** Write a file into the chat folder (and Storage) and return its relative path. */
export async function writeChatFile(ctx: ToolContext, relative: string, content: string | Buffer, open = false): Promise<string> {
  const local = path.join(ctx.files.cwd, ...relative.split("/"));
  await fs.mkdir(path.dirname(local), { recursive: true });
  await fs.writeFile(local, content);
  try {
    await ctx.files.sync(ctx.run, open ? new Set([relative]) : new Set());
  } catch (error) {
    if (open) ctx.files.openWhenSynced(relative);
    ctx.log?.(`sync of ${relative} deferred`, error);
  }
  return relative;
}

/** Keep large results out of the prompt: save them and point the agent at the file. */
export async function compactResult(ctx: ToolContext, payload: unknown): Promise<string> {
  const json = JSON.stringify(payload, null, 1);
  if (json.length <= MAX_INLINE_RESULT) return json;
  const relative = `${ctx.platform === "woocommerce" ? "woo-results" : "shopify-results"}/${stamp()}.json`;
  await writeChatFile(ctx, relative, JSON.stringify(payload, null, 2));
  return (
    `The result is large (${json.length.toLocaleString("en")} characters) and was saved to ${relative}. ` +
    `Read it with read_file, analyse it with run_script, or ask for fewer fields. First part:\n${json.slice(0, 4000)}`
  );
}

/** Rows from a .jsonl or .json (array) file in the chat folder. */
export async function readRows(ctx: ToolContext, relative: string): Promise<Array<Record<string, unknown>>> {
  const local = resolveInChat(ctx.files.cwd, relative);
  const body = await fs.readFile(local, "utf8");
  const trimmed = body.trim();
  let rows: unknown[];
  if (trimmed.startsWith("[")) rows = JSON.parse(trimmed) as unknown[];
  else rows = trimmed.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
  if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) throw new Error("Every row must be a JSON object.");
  return rows as Array<Record<string, unknown>>;
}

/** Read the rows file a bulk tool was given, or say clearly what is wrong with it. */
export async function loadRowsArg(ctx: ToolContext, value: unknown): Promise<Array<Record<string, unknown>> | { error: string }> {
  const rowsFile = String(value ?? "").trim().replace(/^[/\\]+/, "");
  if (!rowsFile) return { error: "Pass `rows_file`: the path in your folder of the .jsonl file you wrote (for example outputs/updates.jsonl)." };
  try {
    const rows = await readRows(ctx, rowsFile);
    if (!rows.length) return { error: "The rows file is empty." };
    if (rows.length > MAX_BULK_ROWS) return { error: `At most ${MAX_BULK_ROWS} rows per bulk change.` };
    return rows;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      error: missing
        ? `There is no file ${rowsFile} in your folder. Check the path with list_files (files written by run_script are under outputs/).`
        : `Could not read the rows: ${(error as Error).message}`,
    };
  }
}

/** A name for a new export that never overwrites an earlier one (it may be the user's backup). */
export async function freshExportName(ctx: ToolContext, requested: unknown): Promise<string> {
  const base = String(requested ?? "export").replace(/[^\w\-]+/g, "-").slice(0, 60) || "export";
  let name = base;
  for (let n = 2; await fs.stat(path.join(ctx.files.cwd, "exports", `${name}.jsonl`)).then(() => true, () => false); n++) name = `${base}-${n}`;
  return name;
}

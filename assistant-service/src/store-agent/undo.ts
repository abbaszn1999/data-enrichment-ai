import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FILES_BUCKET } from "./files";
import { runBulkMutation, bulkMutationErrors, parseBulkLines } from "./shopify/bulk";
import { loadShopifyConnection, shopifyGraphql } from "./shopify/client";
import { restoreOperations, type Backup } from "./shopify/snapshot";
import { loadWooConnection, wooRequest } from "./woocommerce/client";
import { wooBatchErrors, wooRestoreRequests } from "./woocommerce/snapshot";

export type UndoResult = { restored: number; failed: number; errors: string[]; skipped: string[] };

/** Operations of one shape above this count run as a Shopify bulk operation. */
const BULK_THRESHOLD = 50;

/**
 * Put back the values an approved change overwrote. Only the requesting user
 * can undo, once; deletes and fields we cannot read back are not undoable
 * and are listed in `skipped`.
 */
export async function undoApproval(db: SupabaseClient, params: { approvalId: string; userId: string }): Promise<UndoResult> {
  const { data: approval } = await db
    .from("store_agent_approvals")
    .select("id, chat_id, workspace_id, run_id, status, applied_at, undone_at, undoable, backup_path, store_agent_chats!inner(user_id)")
    .eq("id", params.approvalId)
    .maybeSingle();
  const owner = (approval as { store_agent_chats?: { user_id: string } } | null)?.store_agent_chats?.user_id;
  if (!approval || owner !== params.userId) throw new UndoError("This change was not found.", 404);
  if (approval.undone_at) throw new UndoError("This change was already undone.", 409);
  if (approval.status !== "approved" || !approval.applied_at) throw new UndoError("This change was not applied, so there is nothing to undo.", 409);
  if (!approval.undoable || !approval.backup_path) throw new UndoError("This change cannot be undone.", 409);

  // Claim it first so two clicks cannot replay the backup twice.
  const { data: claimed } = await db
    .from("store_agent_approvals")
    .update({ undone_at: new Date().toISOString(), undone_by: params.userId })
    .eq("id", approval.id)
    .is("undone_at", null)
    .select("id");
  if (!claimed?.length) throw new UndoError("This change was already undone.", 409);

  try {
    const { data: blob, error } = await db.storage.from(FILES_BUCKET).download(String(approval.backup_path));
    if (error || !blob) throw new Error("The backup for this change is missing.");
    const backup = JSON.parse(await blob.text()) as Backup;
    const skipped = backup.records.filter((r) => r.unsupported.length).map((r) => `${r.label}: ${r.unsupported.join(", ")}`);
    if (backup.platform === "woocommerce") {
      const result = await undoWoo(db, String(approval.workspace_id), backup);
      await db.from("store_agent_audit_log").insert({
        workspace_id: approval.workspace_id,
        chat_id: approval.chat_id,
        run_id: approval.run_id,
        user_id: params.userId,
        approval_id: approval.id,
        operation: "undo: batch update",
        scope: "woocommerce_catalog",
        query_hash: createHash("sha256").update(`undo:${approval.id}`).digest("hex"),
        affected_ids: result.ids.slice(0, 500),
        ok: result.errors.length === 0,
        error: result.errors.slice(0, 20).join("; ") || null,
      });
      return { restored: result.restored, failed: result.errors.length, errors: result.errors.slice(0, 20), skipped };
    }
    const ops = restoreOperations(backup);
    const conn = await loadShopifyConnection(db, String(approval.workspace_id));

    const errors: string[] = [];
    let restored = 0;
    // Group identical mutations so big undos run as one bulk operation per shape.
    const byQuery = new Map<string, typeof ops>();
    for (const op of ops) byQuery.set(op.query, [...(byQuery.get(op.query) ?? []), op]);
    for (const [query, group] of byQuery) {
      if (group.length > BULK_THRESHOLD) {
        const result = await runBulkMutation(conn, query, group.map((g) => g.variables));
        const failed = bulkMutationErrors(parseBulkLines(result.jsonl));
        const failedLines = new Set(failed.map((f) => f.line));
        restored += group.length - failedLines.size;
        errors.push(...failed.slice(0, 20).map((f) => f.message));
        if (result.status !== "COMPLETED") errors.push(`Bulk undo ended with status ${result.status}.`);
      } else {
        for (const op of group) {
          const res = await shopifyGraphql(conn, op.query, op.variables);
          const messages = [
            ...(res.errors?.map((e) => e.message) ?? []),
            ...Object.values((res.data ?? {}) as Record<string, { userErrors?: Array<{ message: string }> }>).flatMap((v) => v?.userErrors?.map((e) => e.message) ?? []),
          ];
          if (messages.length) errors.push(...messages);
          else restored += op.ids.length;
        }
      }
    }

    await db.from("store_agent_audit_log").insert({
      workspace_id: approval.workspace_id,
      chat_id: approval.chat_id,
      run_id: approval.run_id,
      user_id: params.userId,
      approval_id: approval.id,
      operation: `undo: ${[...new Set(ops.map((o) => /\{\s*(\w+)\(/.exec(o.query)?.[1] ?? "update"))].join(", ")}`,
      scope: "write_products",
      query_hash: createHash("sha256").update(`undo:${approval.id}`).digest("hex"),
      affected_ids: ops.flatMap((o) => o.ids).slice(0, 500),
      ok: errors.length === 0,
      error: errors.slice(0, 20).join("; ") || null,
    });
    return { restored, failed: errors.length, errors: errors.slice(0, 20), skipped };
  } catch (error) {
    // Not everything is known to be restored: let the user try again. Replaying
    // the backup writes the same saved values, so a repeat is harmless.
    await db.from("store_agent_approvals").update({ undone_at: null, undone_by: null }).eq("id", approval.id);
    throw error;
  }
}

/** Write a WooCommerce backup's saved values back, 50 records per batch request. */
async function undoWoo(db: SupabaseClient, workspaceId: string, backup: Backup): Promise<{ restored: number; errors: string[]; ids: string[] }> {
  const conn = await loadWooConnection(db, workspaceId);
  const errors: string[] = [];
  const ids: string[] = [];
  let restored = 0;
  for (const request of wooRestoreRequests(backup.records)) {
    ids.push(...request.ids);
    // Writing saved values again is harmless, so a dropped connection can be retried.
    const res = await wooRequest(conn, { method: "POST", path: request.path, body: request.body, retry: true });
    if (!res.ok) {
      errors.push(`${res.message} (${res.code})`);
      continue;
    }
    const itemErrors = wooBatchErrors(res.data);
    restored += request.ids.length - itemErrors.length;
    errors.push(...itemErrors.map((e) => `${e.id ?? "?"}: ${e.message}`));
  }
  return { restored, errors, ids };
}

export class UndoError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

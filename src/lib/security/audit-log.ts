import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CATALOG_INTELLIGENCE, STORE_ASSISTANT } from "@/lib/product-modules";

export type SecurityAuditAction =
  | "member.role_change"
  | "member.remove"
  | "invite.create"
  | "invite.revoke"
  | "integration.credentials_save"
  | "integration.disconnect"
  | "workspace.delete"
  | "user.delete";

export async function writeSecurityAuditLog(
  admin: SupabaseClient,
  entry: {
    workspaceId?: string | null;
    actorId: string | null;
    action: SecurityAuditAction;
    targetId?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    request?: NextRequest | Request | null;
  }
): Promise<void> {
  const headers =
    entry.request && "headers" in entry.request ? entry.request.headers : null;
  const ip =
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip") ||
    null;
  const userAgent = headers?.get("user-agent") || null;

  const { error } = await admin.from("security_audit_logs").insert({
    workspace_id: entry.workspaceId ?? null,
    actor_id: entry.actorId,
    action: entry.action,
    target_id: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip,
    user_agent: userAgent,
    module: actionModule(entry.action),
  });
  if (error) {
    console.error("[security_audit_logs] insert failed:", error.message);
  }
}

function actionModule(action: SecurityAuditAction): string {
  if (action.startsWith("integration.")) return STORE_ASSISTANT.id;
  if (action.startsWith("workspace.")) return "workspace";
  if (action.startsWith("user.")) return "account";
  return "team";
}

export const AUDIT_CATALOG_MODULE = CATALOG_INTELLIGENCE.id;

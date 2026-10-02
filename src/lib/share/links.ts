import { randomBytes } from "crypto";
import type { createAdminClient } from "@/lib/supabase-admin";
import { sanitizeShareView, type ShareView } from "./view";

/**
 * Public, revocable read-only share links for a sheet (Catalog Intelligence,
 * Product Gallery or the Visualizer). Always resolved through service-role
 * API routes — `share_links` has no anon RLS access, mirroring the existing
 * `workspace_invites` token pattern.
 */

export type ShareResourceType = "catalog" | "gallery" | "visualizer";

export const SHARE_RESOURCE_TYPES: ShareResourceType[] = [
  "catalog",
  "gallery",
  "visualizer",
];

export interface ShareLink {
  id: string;
  workspace_id: string;
  resource_type: ShareResourceType;
  resource_id: string;
  token: string;
  created_by: string;
  /** The sheet view the link opens with; null opens it unfiltered. */
  view: ShareView | null;
  revoked_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
}

type Admin = ReturnType<typeof createAdminClient>;

function newToken(): string {
  return randomBytes(32).toString("hex");
}

export async function getActiveShareLink(
  admin: Admin,
  workspaceId: string,
  resourceType: ShareResourceType,
  resourceId: string
): Promise<ShareLink | null> {
  const { data } = await admin
    .from("share_links")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .is("revoked_at", null)
    .maybeSingle();
  return (data as ShareLink | null) ?? null;
}

/** Revokes any existing active link for the resource so the partial unique
 * index (one active link per resource) never conflicts, then inserts a fresh one. */
export async function createShareLink(
  admin: Admin,
  params: {
    workspaceId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    createdBy: string;
    view?: ShareView | null;
  }
): Promise<ShareLink> {
  await admin
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", params.workspaceId)
    .eq("resource_type", params.resourceType)
    .eq("resource_id", params.resourceId)
    .is("revoked_at", null);

  const { data, error } = await admin
    .from("share_links")
    .insert({
      workspace_id: params.workspaceId,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      token: newToken(),
      created_by: params.createdBy,
      view: sanitizeShareView(params.view),
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Failed to create share link");
  }
  return data as ShareLink;
}

/** "New link" — same as create; kept as a distinct name so call sites read clearly. */
export async function regenerateShareLink(
  admin: Admin,
  params: {
    workspaceId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    createdBy: string;
    view?: ShareView | null;
  }
): Promise<ShareLink> {
  return createShareLink(admin, params);
}

/** Replaces the view the active link opens with. Pass null to open it unfiltered. */
export async function updateShareLinkView(
  admin: Admin,
  params: {
    workspaceId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    view: ShareView | null;
  }
): Promise<ShareLink | null> {
  const { data } = await admin
    .from("share_links")
    .update({ view: sanitizeShareView(params.view) })
    .eq("workspace_id", params.workspaceId)
    .eq("resource_type", params.resourceType)
    .eq("resource_id", params.resourceId)
    .is("revoked_at", null)
    .select("*")
    .maybeSingle();
  return (data as ShareLink | null) ?? null;
}

export async function revokeShareLink(
  admin: Admin,
  workspaceId: string,
  resourceType: ShareResourceType,
  resourceId: string
): Promise<void> {
  await admin
    .from("share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .is("revoked_at", null);
}

/** Public lookup by token for the `/share/[token]` route. Never throws on a
 * missing/revoked token — callers should treat `null` as 404. */
export async function resolveShareToken(
  admin: Admin,
  token: string
): Promise<ShareLink | null> {
  const { data } = await admin
    .from("share_links")
    .select("*")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (!data) return null;
  const link = data as ShareLink;
  try {
    await admin
      .from("share_links")
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("id", link.id);
  } catch {
    // Best-effort view tracking; never block the read on this.
  }
  return link;
}

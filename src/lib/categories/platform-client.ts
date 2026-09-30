/** Browser helpers for the workspace platform used by the Categories tab and Settings. */

export interface CategoryPlatformState {
  cmsType: string;
  categoryCount: number;
}

export async function fetchCategoryPlatform(workspaceId: string): Promise<CategoryPlatformState> {
  const res = await fetch(`/api/workspaces/cms-type?workspaceId=${encodeURIComponent(workspaceId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to load the platform");
  return { cmsType: String(data.cmsType ?? "shopify"), categoryCount: Number(data.categoryCount ?? 0) };
}

/** Switches the platform; the server refuses while the Categories tab has entries. */
export async function changeWorkspacePlatform(workspaceId: string, cmsType: string): Promise<void> {
  const res = await fetch("/api/workspaces/cms-type", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, cmsType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to change the platform");
}

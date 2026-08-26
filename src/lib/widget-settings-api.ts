/**
 * Client access to the workspace's saved widget styles.
 *
 * Both the Customize page and the Stage 6 shape picker write the same row, so
 * they share these two calls: a choice made in either place has to be the one
 * the live storefront serves, and localStorage alone never reaches the store.
 */

import {
  saveCustomizeWidgets,
  type PersistedWidgetSettings,
  type WidgetStyle,
} from "./customize-widgets";

export async function fetchWidgetSettings(
  workspaceId: string
): Promise<PersistedWidgetSettings | null> {
  const res = await fetch(
    `/api/workspaces/widget-settings?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { settings?: PersistedWidgetSettings };
  return data.settings ?? null;
}

/**
 * Persists to the database and mirrors into localStorage, so the next surface
 * to open shows the new shape immediately instead of waiting on a fetch.
 */
export async function saveWidgetSettings(
  workspaceId: string,
  workspaceSlug: string,
  settings: { links: WidgetStyle; faq: WidgetStyle }
): Promise<void> {
  const res = await fetch("/api/workspaces/widget-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, settings }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Failed to save widget settings");
  saveCustomizeWidgets(workspaceSlug, settings);
}

"use client";

import { cn } from "@/lib/utils";
import { useAccountState, useGoogleAds } from "@/lib/google-ads/store";
import { navCtx, tabGroupOf, visibleTabs } from "./nav-model";

/** Tab strip for sidebar items that hold several related pages (Keywords, Audiences, Locations & schedule). */
export function GaViewTabs() {
  const acc = useAccountState();
  const view = useGoogleAds((s) => s.view);
  const scope = useGoogleAds((s) => s.scope);
  const setView = useGoogleAds((s) => s.setView);
  const group = tabGroupOf(view);
  if (!acc || !group) return null;
  const tabs = visibleTabs(group, navCtx(acc.data.campaigns, scope));
  if (tabs.length < 2) return null;
  return (
    <div role="tablist" aria-label={group.label} className="-mt-1 mb-4 flex gap-1 border-b border-border/60">
      {tabs.map((t) => {
        const active = t.view === view;
        return (
          <button
            key={t.view}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setView(t.view)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-xs font-semibold transition-colors",
              active ? "border-[#400095] text-[#400095] dark:border-violet-400 dark:text-violet-300" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import {
  FLOW_TABS,
  isWorkspaceTab,
  tabIndex,
  type FlowTab,
  type WorkspaceTab,
} from "./workspace-data";
import { cn } from "@/lib/utils";

export function WorkspaceStepper({
  current,
  opened,
  onChange,
}: {
  current: FlowTab;
  opened: WorkspaceTab;
  onChange: (tab: FlowTab) => void;
}) {
  const openedIndex = tabIndex(opened);
  const visibleTabs = FLOW_TABS.filter((tab) => {
    if (!isWorkspaceTab(tab.id)) return true;
    return tabIndex(tab.id) <= openedIndex;
  });

  return (
    <div
      role="tablist"
      aria-label="Market research stages"
      className="flex items-center gap-1"
    >
      {visibleTabs.map((tab) => {
        const active = tab.id === current;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <span className="mr-1.5 text-muted-foreground/80">{tab.n}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

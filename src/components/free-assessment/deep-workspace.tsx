"use client";

import type { ReactNode } from "react";
import { StageExtractPanel } from "./stage-extract-panel";
import { WorkspaceStepper } from "./workspace-stepper";
import { cn } from "@/lib/utils";
import type {
  ExtractedKeyword,
  FlowTab,
  SeedExtractProgress,
  WorkspaceTab,
} from "./workspace-data";
import { isWorkspaceTab } from "./workspace-data";
import type { MockSeedRow, SeedProbe } from "./mock-data";

export function DeepWorkspace({
  projectName,
  storeLabel,
  tab,
  opened,
  onTab,
  brief,
  seeds,
  probes,
  keywords,
  extracting,
  extractProgress,
  seedProgress,
  chargedUsd,
  onAnalyze,
  analyzeLoading,
  analyzeProgress,
  analyzed,
  onCancelExtract,
  keywordsCsvHref,
  growthEngineHref,
}: {
  projectName: string;
  storeLabel: string;
  tab: FlowTab;
  opened: WorkspaceTab;
  onTab: (tab: FlowTab) => void;
  brief?: ReactNode;
  seeds: MockSeedRow[];
  probes: Record<string, SeedProbe>;
  keywords: ExtractedKeyword[];
  extracting: boolean;
  extractProgress: number;
  seedProgress: SeedExtractProgress[];
  chargedUsd: number;
  onAnalyze: () => void;
  analyzeLoading: boolean;
  analyzeProgress?: { done: number; total: number } | null;
  analyzed: boolean;
  onCancelExtract?: () => void;
  /** Export of every archived row, not just the on-screen table. */
  keywordsCsvHref?: string;
  growthEngineHref?: string;
}) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 shrink-0">
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {storeLabel}
          </p>
          <p className="text-sm font-semibold tracking-tight truncate">
            {projectName}
          </p>
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <WorkspaceStepper current={tab} opened={opened} onChange={onTab} />
        </div>
      </header>

      <div
        className={cn(
          "flex-1 min-h-0 p-4 sm:p-5",
          tab === "extract"
            ? "flex flex-col overflow-hidden"
            : "overflow-auto"
        )}
      >
        <div
          className={cn(
            tab === "extract" && "flex min-h-0 flex-1 flex-col overflow-hidden"
          )}
        >
          {!isWorkspaceTab(tab) ? brief : null}
          {tab === "extract" ? (
            <StageExtractPanel
              seeds={seeds}
              probes={probes}
              keywords={keywords}
              extracting={extracting}
              progress={extractProgress}
              seedProgress={seedProgress}
              chargedUsd={chargedUsd}
              onAnalyze={onAnalyze}
              analyzeLoading={analyzeLoading}
              analyzeProgress={analyzeProgress}
              analyzed={analyzed}
              onCancelExtract={onCancelExtract}
              csvHref={keywordsCsvHref}
              growthEngineHref={growthEngineHref}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

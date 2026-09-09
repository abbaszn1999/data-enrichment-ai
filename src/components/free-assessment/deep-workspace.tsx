"use client";

import type { ReactNode } from "react";
import { StageCollectionSheet } from "./stage-collection-sheet";
import { StageExtractPanel } from "./stage-extract-panel";
import { WorkspaceStepper } from "./workspace-stepper";
import { cn } from "@/lib/utils";
import type {
  ExtractedKeyword,
  FlowTab,
  ProposedCollection,
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
  onNextCollections,
  onCancelExtract,
  collections,
  clustering,
  clusterProgress,
  selectedCollectionIds,
  onChangeSelected,
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
  onNextCollections: (filteredCategoryKeywords?: ExtractedKeyword[]) => void;
  onCancelExtract?: () => void;
  collections: ProposedCollection[];
  clustering: boolean;
  clusterProgress?: { processed: number; total: number } | null;
  selectedCollectionIds: string[];
  onChangeSelected: (ids: string[]) => void;
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
          tab === "collections"
            ? "flex flex-col overflow-hidden"
            : "overflow-auto"
        )}
      >
        <div
          className={cn(
            tab === "collections" && "flex min-h-0 flex-1 flex-col overflow-hidden"
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
              onNextCollections={onNextCollections}
              clustering={clustering}
              onCancelExtract={onCancelExtract}
            />
          ) : null}
          {tab === "collections" ? (
            <StageCollectionSheet
              collections={collections}
              products={[]}
              loading={clustering}
              loadingProgress={clusterProgress}
              selectedIds={selectedCollectionIds}
              onChangeSelected={onChangeSelected}
              paid={false}
              onStart={() => undefined}
              showStoreActions={false}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

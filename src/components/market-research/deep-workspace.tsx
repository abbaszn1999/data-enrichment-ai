"use client";

import type { ReactNode } from "react";
import { StageAnalyzePanel } from "./stage-analyze-panel";
import { StageCollectionSheet } from "./stage-collection-sheet";
import { StageContentPanel } from "./stage-content-panel";
import { StageExtractPanel } from "./stage-extract-panel";
import { WorkspaceStepper } from "./workspace-stepper";
import type {
  CollectionContent,
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
  onNextCollections,
  collections,
  clustering,
  selectedCollectionIds,
  onChangeSelected,
  collectionsPaid,
  onStartWorking,
  instruction,
  onInstruction,
  contentById,
  generating,
  contentReady,
  pushed,
  onStartContent,
  onPush,
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
  onNextCollections: () => void;
  collections: ProposedCollection[];
  clustering: boolean;
  selectedCollectionIds: string[];
  onChangeSelected: (ids: string[]) => void;
  collectionsPaid: boolean;
  onStartWorking: () => void;
  instruction: string;
  onInstruction: (value: string) => void;
  contentById: Record<string, CollectionContent>;
  generating: boolean;
  contentReady: boolean;
  pushed: boolean;
  onStartContent: () => void;
  onPush: () => void;
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

      <div className="flex-1 min-h-0 overflow-hidden p-4 sm:p-5">
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
          />
        ) : null}
        {tab === "analyze" ? (
          <StageAnalyzePanel
            keywords={keywords}
            loading={analyzeLoading}
            onNext={onNextCollections}
          />
        ) : null}
        {tab === "collections" ? (
          <StageCollectionSheet
            collections={collections}
            loading={clustering}
            selectedIds={selectedCollectionIds}
            onChangeSelected={onChangeSelected}
            paid={collectionsPaid}
            onStart={onStartWorking}
          />
        ) : null}
        {tab === "content" ? (
          <StageContentPanel
            collections={collections.filter((c) =>
              selectedCollectionIds.includes(c.id)
            )}
            contentById={contentById}
            instruction={instruction}
            onInstruction={onInstruction}
            generating={generating}
            ready={contentReady}
            pushed={pushed}
            onStart={onStartContent}
            onPush={onPush}
          />
        ) : null}
      </div>
    </div>
  );
}

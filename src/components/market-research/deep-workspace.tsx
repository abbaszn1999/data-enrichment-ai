"use client";

import type { ReactNode } from "react";
import { StageCollectionSheet } from "./stage-collection-sheet";
import { StageContentPanel } from "./stage-content-panel";
import { StageExtractPanel } from "./stage-extract-panel";
import { StageStrategyPanel } from "./stage-strategy-panel";
import { WorkspaceStepper } from "./workspace-stepper";
import type {
  CollectionContent,
  ExtractedKeyword,
  FlowTab,
  MarketResearchProduct,
  OnPageInstructionField,
  OnPageInstructions,
  ProposedCollection,
  SeedExtractProgress,
  StrategyArticle,
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
  analyzed,
  onNextCollections,
  collectionsGenerated = false,
  onCancelExtract,
  keywordsCsvHref,
  collections,
  products,
  clustering,
  selectedCollectionIds,
  onChangeSelected,
  collectionsPaid,
  onStartWorking,
  onPushToStore,
  pushingCollections = false,
  walletBalance = null,
  walletHref,
  instructions,
  onInstruction,
  contentById,
  generating,
  contentReady,
  pushed,
  syncingSeo = false,
  seoSynced = false,
  onStartContent,
  onPush,
  onSyncSeo,
  pushCostUsd,
  onNextStrategy,
  strategyArticles,
  strategyLoading,
  strategyReady,
  strategyApproved,
  onBuildStrategy,
  onApproveStrategy,
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
  analyzed: boolean;
  onNextCollections: () => void;
  collectionsGenerated?: boolean;
  onCancelExtract?: () => void;
  keywordsCsvHref?: string;
  collections: ProposedCollection[];
  products?: MarketResearchProduct[];
  clustering: boolean;
  selectedCollectionIds: string[];
  onChangeSelected: (ids: string[]) => void;
  collectionsPaid: boolean;
  onStartWorking: () => void;
  onPushToStore?: (selectedIds: string[]) => Promise<void> | void;
  pushingCollections?: boolean;
  walletBalance?: number | null;
  walletHref?: string;
  instructions: OnPageInstructions;
  onInstruction: (field: OnPageInstructionField, value: string) => void;
  contentById: Record<string, CollectionContent>;
  generating: boolean;
  contentReady: boolean;
  pushed: boolean;
  syncingSeo?: boolean;
  seoSynced?: boolean;
  onStartContent: () => void;
  onPush: () => void;
  onSyncSeo?: () => void;
  pushCostUsd?: number;
  onNextStrategy: () => void;
  strategyArticles: StrategyArticle[];
  strategyLoading: boolean;
  strategyReady: boolean;
  strategyApproved: boolean;
  onBuildStrategy: () => void;
  onApproveStrategy: () => void;
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
            analyzeLoading={analyzeLoading}
            analyzed={analyzed}
            onNextCollections={onNextCollections}
            collectionsGenerated={collectionsGenerated}
            onCancelExtract={onCancelExtract}
            csvHref={keywordsCsvHref}
          />
        ) : null}
        {tab === "collections" ? (
          <StageCollectionSheet
            collections={collections}
            products={products}
            loading={clustering}
            selectedIds={selectedCollectionIds}
            onChangeSelected={onChangeSelected}
            paid={collectionsPaid}
            onStart={onStartWorking}
            onPushToStore={onPushToStore}
            pushing={pushingCollections}
            walletBalance={walletBalance}
            walletHref={walletHref}
          />
        ) : null}
        {tab === "content" ? (
          <StageContentPanel
            collections={collections.filter((c) =>
              selectedCollectionIds.includes(c.id)
            )}
            contentById={contentById}
            instructions={instructions}
            onInstruction={onInstruction}
            generating={generating}
            ready={contentReady}
            pushed={pushed}
            syncingSeo={syncingSeo}
            seoSynced={seoSynced}
            onStart={onStartContent}
            onPush={onPush}
            onSyncSeo={onSyncSeo}
            pushCostUsd={pushCostUsd}
            onNextStrategy={onNextStrategy}
          />
        ) : null}
        {tab === "strategy" ? (
          <StageStrategyPanel
            articles={strategyArticles}
            loading={strategyLoading}
            ready={strategyReady}
            approved={strategyApproved}
            onBuild={onBuildStrategy}
            onApprove={onApproveStrategy}
          />
        ) : null}
      </div>
    </div>
  );
}

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
  GeneratedArticle,
  ProposedCollection,
  SeedExtractProgress,
  StoreBlog,
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
  generatedArticles,
  storeBlogs = [],
  storeUrl = "",
  blogScopeWarning = null,
  strategyLoading,
  strategyReady,
  articlesSyncing = false,
  articlesSyncProgress = null,
  onBuildStrategy,
  onGenerateArticles,
  onSyncArticles,
  onArticleChange,
  onArticleTitleChange,
  readOnly = false,
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
  onNextCollections: (filteredCategoryKeywords?: ExtractedKeyword[]) => void;
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
  generatedArticles: Record<string, GeneratedArticle>;
  storeBlogs?: StoreBlog[];
  storeUrl?: string;
  blogScopeWarning?: string | null;
  strategyLoading: boolean;
  strategyReady: boolean;
  articlesSyncing?: boolean;
  articlesSyncProgress?: { done: number; total: number } | null;
  onBuildStrategy: () => void;
  onGenerateArticles: (ids: string[]) => void;
  onSyncArticles: (ids: string[]) => void;
  onArticleChange: (articleId: string, patch: Partial<GeneratedArticle>) => void;
  onArticleTitleChange: (articleId: string, title: string) => void;
  readOnly?: boolean;
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

      <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
        <div className={readOnly ? "pointer-events-none" : undefined}>
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
            clustering={clustering}
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
            generatedById={generatedArticles}
            blogs={storeBlogs}
            storeUrl={storeUrl}
            scopeWarning={blogScopeWarning}
            loading={strategyLoading}
            ready={strategyReady}
            syncing={articlesSyncing}
            syncProgress={articlesSyncProgress}
            onBuild={onBuildStrategy}
            onGenerate={onGenerateArticles}
            onSync={onSyncArticles}
            onArticleChange={onArticleChange}
            onTitleChange={onArticleTitleChange}
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}

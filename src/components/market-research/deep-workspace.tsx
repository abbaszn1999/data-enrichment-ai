"use client";

import type { ReactNode } from "react";
import { StageCollectionSheet } from "./stage-collection-sheet";
import { StageContentPanel } from "./stage-content-panel";
import { StageExtractPanel } from "./stage-extract-panel";
import { StageStrategyPanel } from "./stage-strategy-panel";
import { WorkspaceStepper } from "./workspace-stepper";
import { cn } from "@/lib/utils";
import type {
  CollectionContent,
  CollectionLink,
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
  analyzeProgress,
  productEmbedProgress,
  analyzed,
  onNextCollections,
  onCancelExtract,
  keywordsCsvHref,
  collections,
  products,
  clustering,
  clusterProgress,
  termEmbedProgress,
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
  internalLinksById,
  linksBuildProgress,
  generating,
  contentGenProgress,
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
  /** Live progress across the chunked classification requests (Layer 1). */
  analyzeProgress?: { done: number; total: number } | null;
  /** Product embedding pass, driven in parallel with the Apify extract poll above. */
  productEmbedProgress?: { embedded: number; total: number; done: boolean } | null;
  analyzed: boolean;
  onNextCollections: (filteredCategoryKeywords?: ExtractedKeyword[]) => void;
  onCancelExtract?: () => void;
  keywordsCsvHref?: string;
  collections: ProposedCollection[];
  products?: MarketResearchProduct[];
  clustering: boolean;
  /** Live progress across the Stage 5 cluster cursor job's offset pages. */
  clusterProgress?: { processed: number; total: number } | null;
  /** Category-term embedding pass that runs before the cluster job starts. */
  termEmbedProgress?: { embedded: number; total: number; done: boolean } | null;
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
  internalLinksById?: Record<string, CollectionLink[]>;
  /** Live progress across the background internal-link cursor job's pages. */
  linksBuildProgress?: { processed: number; total: number } | null;
  generating: boolean;
  /** Live progress across the Stage 6 on-page copywriting cursor job's pages. */
  contentGenProgress?: { processed: number; total: number } | null;
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
            readOnly && "pointer-events-none",
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
            productEmbedProgress={productEmbedProgress}
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
            loadingProgress={clusterProgress}
            termEmbedProgress={termEmbedProgress}
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
            internalLinksById={internalLinksById}
            linksBuildProgress={linksBuildProgress}
            instructions={instructions}
            onInstruction={onInstruction}
            generating={generating}
            contentGenProgress={contentGenProgress}
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

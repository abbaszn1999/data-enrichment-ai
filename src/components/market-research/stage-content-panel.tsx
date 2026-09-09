"use client";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Eye,
  ExternalLink,
  FileText,
  HelpCircle,
  Link2,
  Loader2,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/market-research/cost";
import { sanitizeRichText, stripTags } from "@/lib/market-research/rich-text";
import { OnPageShapePicker } from "@/components/customize/on-page-shape-picker";
import {
  USD_PER_COLLECTION,
  type CollectionContent,
  type CollectionLink,
  type OnPageInstructionField,
  type OnPageInstructions,
  type ProposedCollection,
} from "./workspace-data";

type FullTextField = "seoTitle" | "seoDescription" | "collectionDescription";

const FULL_TEXT_FIELD_LABEL: Record<FullTextField, string> = {
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  collectionDescription: "Collection description",
};

const FIELD_META: {
  id: OnPageInstructionField;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    id: "seoTitle",
    label: "SEO title",
    hint: "How the title tag should be written for every collection.",
    placeholder: "e.g. Include the brand, keep under 60 characters…",
  },
  {
    id: "seoDescription",
    label: "SEO description",
    hint: "How the meta description should sound.",
    placeholder: "e.g. Mention shipping, avoid hype, include a CTA…",
  },
  {
    id: "collectionDescription",
    label: "Collection description",
    hint: "How the on-page description should be written.",
    placeholder: "e.g. Conversational, 80–120 words, no medical claims…",
  },
  {
    id: "faq",
    label: "FAQ",
    hint: "How questions and answers should be written.",
    placeholder: "e.g. 4 questions, answer for shoppers not Google…",
  },
];

export function StageContentPanel({
  collections,
  contentById,
  internalLinksById,
  linksBuildProgress,
  instructions,
  onInstruction,
  generating,
  contentGenProgress,
  ready,
  pushed,
  syncingSeo = false,
  seoSynced = false,
  onStart,
  onPush,
  onSyncSeo,
  onNextStrategy,
  pushCostUsd,
}: {
  collections: ProposedCollection[];
  contentById: Record<string, CollectionContent>;
  /**
   * Internal link graph, precomputed while pushing collections to the store
   * (before "Generate" is clicked). Used as a fallback so the "Internal
   * Links" column/dialog show data immediately, even before on-page copy has
   * been generated.
   */
  internalLinksById?: Record<string, CollectionLink[]>;
  /** Live progress across the background internal-link cursor job's pages. */
  linksBuildProgress?: { processed: number; total: number } | null;
  instructions: OnPageInstructions;
  onInstruction: (field: OnPageInstructionField, value: string) => void;
  generating: boolean;
  /** Live progress across the Stage 6 on-page copywriting cursor job's pages. */
  contentGenProgress?: { processed: number; total: number } | null;
  ready: boolean;
  pushed: boolean;
  syncingSeo?: boolean;
  seoSynced?: boolean;
  onStart: () => void;
  onPush?: () => void;
  onSyncSeo?: () => void;
  onNextStrategy: () => void;
  pushCostUsd?: number;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openField, setOpenField] = useState<OnPageInstructionField | null>(null);

  // Active modal views for FAQs and Links
  const [activeFaqColId, setActiveFaqColId] = useState<string | null>(null);
  const [activeLinksColId, setActiveLinksColId] = useState<string | null>(null);
  // Hover-eye "view full text" modal for SEO title / description / collection description
  const [activeTextCell, setActiveTextCell] = useState<{
    colId: string;
    field: FullTextField;
  } | null>(null);

  const preview = previewId ? contentById[previewId] : undefined;
  const previewCol = collections.find((c) => c.id === previewId);
  const fieldMeta = FIELD_META.find((f) => f.id === openField);
  const locked = generating || ready;
  const pushCost = pushCostUsd ?? collections.length * USD_PER_COLLECTION;

  const activeFaqContent = activeFaqColId ? contentById[activeFaqColId] : null;
  const activeFaqCol = activeFaqColId ? collections.find((c) => c.id === activeFaqColId) : null;

  const activeLinksCol = activeLinksColId ? collections.find((c) => c.id === activeLinksColId) : null;

  const activeTextCol = activeTextCell
    ? collections.find((c) => c.id === activeTextCell.colId)
    : null;
  const activeTextValue =
    activeTextCell && contentById[activeTextCell.colId]
      ? contentById[activeTextCell.colId][activeTextCell.field]
      : "";

  /**
   * Links for a collection: prefer the ones baked into generated content, but
   * fall back to the precomputed graph built during push, so the column and
   * dialog are populated the moment Tab 6 opens — before "Generate" runs.
   */
  const linksFor = (id: string): CollectionLink[] =>
    contentById[id]?.links ?? internalLinksById?.[id] ?? [];
  const activeLinks = activeLinksColId ? linksFor(activeLinksColId) : [];

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight">On-page Copywriting & Internal Links</h2>
            <p className="text-[11px] text-muted-foreground">
              Click the sparkle on any column to customize AI generation rules before starting.
            </p>
          </div>
          {linksBuildProgress ? (
            <Badge
              variant="outline"
              className="h-6 shrink-0 gap-1.5 rounded-full border-emerald-500/30 bg-emerald-500/5 px-2.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              Links {linksBuildProgress.processed.toLocaleString()}/
              {linksBuildProgress.total.toLocaleString()}
            </Badge>
          ) : null}
          <div className="flex items-center gap-2">
            {ready ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  disabled={!previewId && collections.length === 0}
                  onClick={() => setPreviewId(collections[0]?.id ?? null)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Customize Widgets
                </Button>
                <Button
                  size="sm"
                  variant={seoSynced ? "outline" : "default"}
                  className={cn(
                    "h-8 text-xs gap-1.5 font-medium transition-all",
                    seoSynced &&
                      "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10"
                  )}
                  disabled={syncingSeo || seoSynced}
                  onClick={onSyncSeo ?? onPush}
                >
                  {syncingSeo ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Syncing SEO…</span>
                    </>
                  ) : seoSynced ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Synced to Store</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-3.5 w-3.5" />
                      <span>Sync SEO to Store</span>
                    </>
                  )}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={generating}
                onClick={onStart}
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generating
                  ? contentGenProgress
                    ? `Writing Copy… ${contentGenProgress.processed.toLocaleString()}/${contentGenProgress.total.toLocaleString()}`
                    : "Writing Copy & Links…"
                  : "Start"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs min-w-[160px]">Collection</TableHead>
              {FIELD_META.map((field) => {
                const filled = Boolean(instructions[field.id].trim());
                return (
                  <TableHead key={field.id} className="text-xs min-w-[200px]">
                    <button
                      type="button"
                      onClick={() => setOpenField(field.id)}
                      title={
                        filled
                          ? "Edit custom instruction"
                          : "Add custom instruction"
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-1 py-0.5 -ml-1 text-left transition-colors hover:bg-muted/70",
                        filled && "text-primary font-medium"
                      )}
                    >
                      <span>{field.label}</span>
                      <Sparkles
                        className={cn(
                          "h-3 w-3 shrink-0",
                          filled
                            ? "text-primary fill-primary/20"
                            : "text-muted-foreground/60"
                        )}
                      />
                    </button>
                  </TableHead>
                );
              })}
              <TableHead className="text-xs min-w-[150px]">Internal Links</TableHead>
              <TableHead className="text-xs min-w-[120px]">Store</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {collections.map((row) => {
              const content = contentById[row.id];
              const filled = Boolean(content) && (ready || generating);
              const rowLinks = linksFor(row.id);
              return (
                <TableRow key={row.id}>
                  <TableCell className="text-sm font-medium whitespace-nowrap">
                    <button
                      type="button"
                      className="text-left hover:underline text-foreground flex items-center gap-1.5"
                      onClick={() => content && setPreviewId(row.id)}
                    >
                      <span>{row.name}</span>
                    </button>
                  </TableCell>
                  <ContentCell
                    ready={filled}
                    generating={generating && !content}
                    text={content?.seoTitle}
                    onView={() =>
                      setActiveTextCell({ colId: row.id, field: "seoTitle" })
                    }
                  />
                  <ContentCell
                    ready={filled}
                    generating={generating && !content}
                    text={content?.seoDescription}
                    onView={() =>
                      setActiveTextCell({ colId: row.id, field: "seoDescription" })
                    }
                  />
                  <ContentCell
                    ready={filled}
                    generating={generating && !content}
                    text={content?.collectionDescription}
                    onView={() =>
                      setActiveTextCell({
                        colId: row.id,
                        field: "collectionDescription",
                      })
                    }
                  />
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {content && content.faqs && content.faqs.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveFaqColId(row.id)}
                        className="h-7 px-2 text-[11px] font-medium text-primary hover:text-primary hover:bg-primary/10 gap-1"
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                        <span>{content.faqs.length} questions</span>
                      </Button>
                    ) : generating ? (
                      <Pulse />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {rowLinks.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveLinksColId(row.id)}
                        className="h-7 px-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-1"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        <span>{rowLinks.length} links</span>
                      </Button>
                    ) : generating ? (
                      <Pulse />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[11px]">
                    <SyncStatusCell
                      content={content}
                      syncing={syncingSeo}
                      generating={generating}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {ready ? (
        <div className="flex items-center justify-between gap-2 shrink-0">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {seoSynced ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <Check className="h-3.5 w-3.5" />
                SEO copy and descriptions synced directly to your live store collections.
              </span>
            ) : (
              <span>
                Use &ldquo;Sync SEO to Store&rdquo; to update collection descriptions &amp; meta tags on your live storefront for free.
              </span>
            )}
          </p>
          <Button
            size="sm"
            className="h-8 shrink-0 text-xs"
            onClick={onNextStrategy}
          >
            Next · Content strategy
          </Button>
        </div>
      ) : null}

      {/* Custom Instruction Dialog */}
      <Dialog
        open={Boolean(openField)}
        onOpenChange={(open) => !open && setOpenField(null)}
      >
        <DialogContent className="sm:max-w-md">
          {fieldMeta ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  Custom instruction · {fieldMeta.label}
                </DialogTitle>
                <DialogDescription>{fieldMeta.hint}</DialogDescription>
              </DialogHeader>
              <textarea
                value={instructions[fieldMeta.id]}
                onChange={(e) => onInstruction(fieldMeta.id, e.target.value)}
                placeholder={fieldMeta.placeholder}
                disabled={locked}
                rows={5}
                className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-xs shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <DialogFooter>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setOpenField(null)}
                >
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* FAQs View Modal */}
      <Dialog
        open={Boolean(activeFaqColId)}
        onOpenChange={(open) => !open && setActiveFaqColId(null)}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              <span>Generated FAQs · {activeFaqCol?.name}</span>
            </DialogTitle>
            <DialogDescription>
              Frequently asked questions written for shoppers and optimized for search rich snippets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {activeFaqContent?.faqs && activeFaqContent.faqs.length > 0 ? (
              activeFaqContent.faqs.map((faq, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-border/70 bg-muted/30 p-3.5 space-y-1.5"
                >
                  <p className="text-xs font-semibold text-foreground flex items-start gap-1.5">
                    <span className="text-primary font-bold">Q{idx + 1}:</span>
                    <span>{stripTags(faq.q)}</span>
                  </p>
                  <p
                    className="text-xs text-muted-foreground leading-relaxed pl-5 [&_a]:underline [&_a]:underline-offset-2 [&_a]:text-primary hover:[&_a]:text-primary/80"
                    // The on-page agent may weave one verified internal link into
                    // an answer; sanitizeRichText only lets that exact
                    // <a href="/...">text</a> shape through, escaping the rest.
                    dangerouslySetInnerHTML={{ __html: sanitizeRichText(faq.a) }}
                  />
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No FAQs generated yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setActiveFaqColId(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Internal Links View Modal */}
      <Dialog
        open={Boolean(activeLinksColId)}
        onOpenChange={(open) => !open && setActiveLinksColId(null)}
      >
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Internal Links · {activeLinksCol?.name}</span>
            </DialogTitle>
            <DialogDescription>
              Semantic links calculated by vector similarity to keep link juice within your category hub.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {activeLinks.length > 0 ? (
              activeLinks.map((link, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border/70 bg-muted/30 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{link.label}</p>
                    <p className="text-[10px] font-mono text-muted-foreground truncate">{link.href}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                    Linked
                  </Badge>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No internal links generated yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setActiveLinksColId(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full Text View Modal — hover-eye on SEO title / SEO description / collection description cells */}
      <Dialog
        open={Boolean(activeTextCell)}
        onOpenChange={(open) => !open && setActiveTextCell(null)}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <span>
                {activeTextCell ? FULL_TEXT_FIELD_LABEL[activeTextCell.field] : ""} ·{" "}
                {activeTextCol?.name}
              </span>
            </DialogTitle>
            <DialogDescription>Full generated text for this field.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {activeTextValue ? (
              activeTextCell?.field === "collectionDescription" ? (
                <p
                  className="text-sm leading-relaxed text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a]:text-primary hover:[&_a]:text-primary/80"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(activeTextValue) }}
                />
              ) : (
                <p className="text-sm leading-relaxed text-foreground">
                  {activeTextValue}
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">Nothing generated yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setActiveTextCell(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customize Sheet */}
      <Sheet open={Boolean(preview)} onOpenChange={(open) => !open && setPreviewId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {preview && previewCol ? (
            <>
              <SheetHeader>
                <SheetTitle>{previewCol.name}</SheetTitle>
                <SheetDescription>
                  Pick the FAQ and links widget shapes. Placement is fixed: FAQ above products, links below.
                </SheetDescription>
              </SheetHeader>
              <OnPageShapePicker
                collection={previewCol}
                content={preview}
              />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ContentCell({
  ready,
  generating,
  text,
  onView,
}: {
  ready: boolean;
  generating: boolean;
  text?: string;
  /** Opens the full-text dialog for this cell's field. */
  onView?: () => void;
}) {
  if (generating) {
    return (
      <TableCell>
        <Pulse />
      </TableCell>
    );
  }
  if (!ready || !text) {
    return (
      <TableCell className="text-[11px] text-muted-foreground">—</TableCell>
    );
  }
  return (
    <TableCell className="max-w-[220px] text-[11px] text-muted-foreground">
      <button
        type="button"
        onClick={onView}
        className="group flex w-full items-start gap-1.5 text-left"
      >
        <span className="line-clamp-2 flex-1">{stripTags(text)}</span>
        <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      </button>
    </TableCell>
  );
}

function Pulse() {
  return <div className="h-3 w-28 animate-pulse rounded bg-muted" />;
}

/** Whether this row's copy is live on the store, per row rather than per batch. */
function SyncStatusCell({
  content,
  syncing,
  generating,
}: {
  content?: CollectionContent;
  syncing: boolean;
  generating: boolean;
}) {
  if (!content) {
    return generating ? (
      <Pulse />
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }

  if (content.seoSyncError) {
    return (
      <span
        className="flex items-center gap-1 font-medium text-destructive"
        title={content.seoSyncError}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Failed
      </span>
    );
  }

  if (content.seoSyncedAt) {
    return (
      <span
        className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400"
        title={`Synced ${new Date(content.seoSyncedAt).toLocaleString()}`}
      >
        <Check className="h-3.5 w-3.5" />
        Synced
      </span>
    );
  }

  if (syncing) {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Syncing
      </span>
    );
  }

  return <span className="text-muted-foreground">Not synced</span>;
}

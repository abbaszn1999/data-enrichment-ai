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
import { OnPageShapePicker } from "@/components/customize/on-page-shape-picker";
import {
  USD_PER_COLLECTION,
  type CollectionContent,
  type OnPageInstructionField,
  type OnPageInstructions,
  type ProposedCollection,
} from "./workspace-data";

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
  instructions,
  onInstruction,
  generating,
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
  instructions: OnPageInstructions;
  onInstruction: (field: OnPageInstructionField, value: string) => void;
  generating: boolean;
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

  const preview = previewId ? contentById[previewId] : undefined;
  const previewCol = collections.find((c) => c.id === previewId);
  const fieldMeta = FIELD_META.find((f) => f.id === openField);
  const locked = generating || ready;
  const pushCost = pushCostUsd ?? collections.length * USD_PER_COLLECTION;

  const activeFaqContent = activeFaqColId ? contentById[activeFaqColId] : null;
  const activeFaqCol = activeFaqColId ? collections.find((c) => c.id === activeFaqColId) : null;

  const activeLinksContent = activeLinksColId ? contentById[activeLinksColId] : null;
  const activeLinksCol = activeLinksColId ? collections.find((c) => c.id === activeLinksColId) : null;

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
                {generating ? "Writing Copy & Links…" : "Start"}
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
                  />
                  <ContentCell
                    ready={filled}
                    generating={generating && !content}
                    text={content?.seoDescription}
                  />
                  <ContentCell
                    ready={filled}
                    generating={generating && !content}
                    text={content?.collectionDescription}
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
                    {content && content.links && content.links.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveLinksColId(row.id)}
                        className="h-7 px-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-1"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        <span>{content.links.length} links</span>
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
                    <span>{faq.q}</span>
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-5">
                    {faq.a}
                  </p>
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
            {activeLinksContent?.links && activeLinksContent.links.length > 0 ? (
              activeLinksContent.links.map((link, idx) => (
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
}: {
  ready: boolean;
  generating: boolean;
  text?: string;
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
      <span className="line-clamp-2">{text}</span>
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

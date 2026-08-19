"use client";

import { useState } from "react";
import { Check, Eye, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  onStart,
  onPush,
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
  onStart: () => void;
  onPush: () => void;
  onNextStrategy: () => void;
  pushCostUsd?: number;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openField, setOpenField] = useState<OnPageInstructionField | null>(
    null
  );
  const preview = previewId ? contentById[previewId] : undefined;
  const previewCol = collections.find((c) => c.id === previewId);
  const fieldMeta = FIELD_META.find((f) => f.id === openField);
  const locked = generating || ready;
  const pushCost =
    pushCostUsd ?? collections.length * USD_PER_COLLECTION;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight">On-page</h2>
            <p className="text-[11px] text-muted-foreground">
              Click the sparkle on a column to add a custom instruction before
              Start.
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
                  onClick={() =>
                    setPreviewId(collections[0]?.id ?? null)
                  }
                >
                  <Eye className="h-3.5 w-3.5" />
                  Customize
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={pushed}
                  onClick={onPush}
                >
                  {pushed
                    ? "Pushed"
                    : `Push · ${formatUsd(pushCost)}`}
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
                {generating ? "Writing…" : "Start"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Collection</TableHead>
              {FIELD_META.map((field) => {
                const filled = Boolean(instructions[field.id].trim());
                return (
                  <TableHead key={field.id} className="text-xs">
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
                        filled && "text-primary"
                      )}
                    >
                      <span>{field.label}</span>
                      <Sparkles
                        className={cn(
                          "h-3 w-3 shrink-0",
                          filled
                            ? "text-primary"
                            : "text-muted-foreground/60"
                        )}
                      />
                    </button>
                  </TableHead>
                );
              })}
              <TableHead className="text-xs">Links</TableHead>
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
                      className="text-left hover:underline"
                      onClick={() => content && setPreviewId(row.id)}
                    >
                      {row.name}
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
                  <TableCell className="text-[11px] text-muted-foreground">
                    {content ? `${content.faqs.length} questions` : generating ? (
                      <Pulse />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {content ? `${content.links.length} links` : generating ? (
                      <Pulse />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {ready ? (
        <div className="flex items-center justify-between gap-2 shrink-0">
          {pushed ? (
            <p className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Collections queued to the storefront. Customize still lets you pick
              FAQ and links shapes.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Push queues collections to the storefront. Next opens the content
              strategy plan.
            </p>
          )}
          <Button
            size="sm"
            className="h-8 shrink-0 text-xs"
            onClick={onNextStrategy}
          >
            Next · Content strategy
          </Button>
        </div>
      ) : null}

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

      <Sheet open={Boolean(preview)} onOpenChange={(open) => !open && setPreviewId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {preview && previewCol ? (
            <>
              <SheetHeader>
                <SheetTitle>{previewCol.name}</SheetTitle>
                <SheetDescription>
                  Pick the FAQ and links shapes. Placement is fixed: FAQ above
                  products, links below.
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

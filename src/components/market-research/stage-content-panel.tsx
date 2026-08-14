"use client";

import { useState } from "react";
import { Check, Eye, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type {
  CollectionContent,
  ProposedCollection,
} from "./workspace-data";
import { cn } from "@/lib/utils";

export function StageContentPanel({
  collections,
  contentById,
  instruction,
  onInstruction,
  generating,
  ready,
  pushed,
  onStart,
  onPush,
}: {
  collections: ProposedCollection[];
  contentById: Record<string, CollectionContent>;
  instruction: string;
  onInstruction: (value: string) => void;
  generating: boolean;
  ready: boolean;
  pushed: boolean;
  onStart: () => void;
  onPush: () => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = previewId ? contentById[previewId] : undefined;
  const previewCol = collections.find((c) => c.id === previewId);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Content</h2>
            <p className="text-[11px] text-muted-foreground">
              Custom instruction applies to title tag, meta description,
              collection description, and FAQ.
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
                  {pushed ? "Pushed" : "Push"}
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
        <Input
          value={instruction}
          onChange={(e) => onInstruction(e.target.value)}
          placeholder="Custom instruction — tone, brand voice, words to avoid…"
          className="h-9 text-xs"
          disabled={generating || ready}
          aria-label="Custom instruction for SEO fields"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Collection</TableHead>
              <TableHead className="text-xs">SEO title</TableHead>
              <TableHead className="text-xs">SEO description</TableHead>
              <TableHead className="text-xs">Collection description</TableHead>
              <TableHead className="text-xs">FAQ</TableHead>
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

      {pushed ? (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 shrink-0">
          <Check className="h-3.5 w-3.5" />
          Collections queued to the storefront. Customize still opens a live
          preview of FAQ and links.
        </p>
      ) : null}

      <Sheet open={Boolean(preview)} onOpenChange={(open) => !open && setPreviewId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {preview && previewCol ? (
            <>
              <SheetHeader>
                <SheetTitle>{previewCol.name}</SheetTitle>
                <SheetDescription>
                  How the FAQ and links will read on the collection page.
                </SheetDescription>
              </SheetHeader>
              <CollectionPreview content={preview} collection={previewCol} />
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

function CollectionPreview({
  content,
  collection,
}: {
  content: CollectionContent;
  collection: ProposedCollection;
}) {
  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Title tag
        </p>
        <p className="text-sm font-semibold">{content.seoTitle}</p>
        <p className="text-xs text-muted-foreground">{content.seoDescription}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold tracking-tight">{collection.name}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {content.collectionDescription}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg border border-border/70 bg-muted/40"
          />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {collection.productCount.toLocaleString("en-US")} products in this
        collection
      </p>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">FAQ</h4>
        <ul className="space-y-2">
          {content.faqs.map((faq) => (
            <li
              key={faq.q}
              className="rounded-lg border border-border/70 px-3 py-2"
            >
              <p className="text-xs font-medium">{faq.q}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {faq.a}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-muted-foreground">
          Marked up as FAQPage alongside CollectionPage + ItemList.
        </p>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold">Links</h4>
        <ul className="flex flex-wrap gap-1.5">
          {content.links.map((link) => (
            <li
              key={link.href}
              className={cn(
                "rounded-full border border-border/70 px-2.5 py-0.5 text-[11px] text-muted-foreground"
              )}
            >
              {link.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

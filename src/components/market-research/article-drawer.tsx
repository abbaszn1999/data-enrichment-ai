"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  GeneratedArticle,
  StoreBlog,
  StrategyArticle,
} from "./workspace-data";

const SEO_TITLE_LIMIT = 60;
const SEO_DESCRIPTION_LIMIT = 160;

/**
 * The body keeps store-relative links, which are correct once published. For
 * the preview they are pointed at the storefront so clicking one doesn't land
 * the merchant back inside this app.
 */
function previewHtml(bodyHtml: string, storeUrl: string): string {
  const origin = (storeUrl || "").trim().replace(/\/+$/, "");
  if (!origin) return bodyHtml;
  return bodyHtml.replace(
    /(<a\b[^>]*\bhref=")(\/[^"]*)(")/gi,
    (_match, before: string, path: string, after: string) =>
      `${before}${origin}${path}${after}`
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        {hint ? (
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

/**
 * Half-screen editor for one generated article. Everything shown here is the
 * copy that will be uploaded, so each field is editable in place — the merchant
 * gets the last word before it reaches the store.
 */
export function ArticleDrawer({
  row,
  article,
  blogs,
  storeUrl,
  syncing,
  onOpenChange,
  onChange,
  onTitleChange,
  onSync,
}: {
  row: StrategyArticle | null;
  article: GeneratedArticle | null;
  blogs: StoreBlog[];
  storeUrl: string;
  syncing: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (articleId: string, patch: Partial<GeneratedArticle>) => void;
  onTitleChange: (articleId: string, title: string) => void;
  onSync: (articleId: string) => void;
}) {
  const open = Boolean(row && article);
  if (!row || !article) {
    return <Sheet open={false} onOpenChange={onOpenChange} />;
  }

  const scheduled = article.scheduledAt
    ? new Date(article.scheduledAt)
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-full gap-0 p-0 sm:max-w-none sm:w-1/2"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-sm">Article draft</SheetTitle>
          <SheetDescription className="text-[11px]">
            Targeting “{row.keyword}” · {row.volume.toLocaleString("en-US")}{" "}
            searches/mo · KD {row.difficulty}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3">
            <Field label="Title">
              {/* Keyed per row so switching articles resets the field without
                  an effect, and committed on blur to avoid re-rendering the
                  whole table on every keystroke. */}
              <input
                key={row.id}
                defaultValue={row.title}
                onBlur={(event) =>
                  onTitleChange(row.id, event.target.value.trim() || row.title)
                }
                className="h-9 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-none focus:border-foreground/30"
              />
            </Field>

            <Field
              label="SEO title"
              hint={`${article.seoTitle.length}/${SEO_TITLE_LIMIT}`}
            >
              <input
                value={article.seoTitle}
                maxLength={SEO_TITLE_LIMIT}
                onChange={(event) =>
                  onChange(article.articleId, { seoTitle: event.target.value })
                }
                className="h-9 w-full rounded-lg border border-border/70 bg-background px-3 text-sm outline-none focus:border-foreground/30"
              />
            </Field>

            <Field
              label="SEO description"
              hint={`${article.seoDescription.length}/${SEO_DESCRIPTION_LIMIT}`}
            >
              <textarea
                value={article.seoDescription}
                maxLength={SEO_DESCRIPTION_LIMIT}
                rows={3}
                onChange={(event) =>
                  onChange(article.articleId, {
                    seoDescription: event.target.value,
                  })
                }
                className="w-full resize-none rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30"
              />
            </Field>

            <Field label="Blog category">
              <select
                value={article.blogTitle}
                onChange={(event) =>
                  onChange(article.articleId, { blogTitle: event.target.value })
                }
                className="h-9 w-full rounded-lg border border-border/70 bg-background px-2 text-sm outline-none focus:border-foreground/30"
              >
                <option value="none">
                  {blogs.length === 0
                    ? "No blogs on this store"
                    : "none — use the default blog"}
                </option>
                {blogs.map((blog) => (
                  <option key={blog.id} value={blog.title}>
                    {blog.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {article.featuredImage?.url ? (
            <div className="mt-5 border-t border-border/60 pt-4">
              <p className="text-[11px] font-medium text-foreground">
                Featured image
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={article.featuredImage.url}
                alt={article.featuredImage.alt}
                className="mt-2 aspect-[16/9] w-full rounded-lg object-cover"
              />
            </div>
          ) : null}

          <div className="mt-5 border-t border-border/60 pt-4">
            <p className="text-[11px] font-medium text-foreground">Article</p>
            <div
              className={cn(
                "prose prose-sm dark:prose-invert mt-2 max-w-none",
                "prose-headings:font-semibold prose-img:rounded-lg"
              )}
              dangerouslySetInnerHTML={{
                __html: previewHtml(article.bodyHtml, storeUrl),
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          {scheduled ? (
            <p className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
              <CalendarClock className="h-3.5 w-3.5" />
              Scheduled for{" "}
              {scheduled.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {row.linksOut.length} internal link
              {row.linksOut.length === 1 ? "" : "s"} placed ·{" "}
              {article.images.length} image
              {article.images.length === 1 ? "" : "s"}
            </p>
          )}
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={syncing || Boolean(scheduled)}
            onClick={() => onSync(article.articleId)}
          >
            {syncing ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Syncing
              </>
            ) : scheduled ? (
              "Scheduled"
            ) : (
              "Sync to store"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const HTML_TAG_RE =
  /<\/?(?:p|div|section|article|header|footer|main|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|strong|em|b|i|u|br|hr|span|a|img|blockquote|dl|dt|dd|figure|figcaption|small|sup|sub|code|pre)\b[^>]*>/gi;

/** True when a value is real HTML markup (at least two known tags), not text like "<5kg". */
export function looksLikeHtml(value: string): boolean {
  if (!value || value.indexOf("<") === -1) return false;
  HTML_TAG_RE.lastIndex = 0;
  let count = 0;
  while (HTML_TAG_RE.exec(value)) {
    if (++count >= 2) return true;
  }
  return false;
}

/** Readable text for a sheet cell: block tags become breaks, the rest is stripped. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const HTML_PREVIEW_STYLES = `
  body { margin: 20px; font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111827; background: #fff; }
  h1, h2, h3, h4 { line-height: 1.3; margin: 1.1em 0 0.5em; color: #0f172a; }
  h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.12em; }
  p { margin: 0.6em 0; } ul, ol { padding-inline-start: 1.4em; } li { margin: 0.25em 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: start; vertical-align: top; }
  th { background: #f8fafc; font-weight: 600; }
  img { max-width: 100%; height: auto; } a { color: #4f46e5; }
  blockquote { margin: 0.8em 0; padding-inline-start: 1em; border-inline-start: 3px solid #e5e7eb; color: #475569; }
`;

/**
 * Renders cell HTML the way a storefront would. The sandboxed iframe (no
 * scripts, own origin) keeps untrusted sheet/AI markup from touching the app.
 */
export function HtmlPreview({ html, className }: { html: string; className?: string }) {
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><base target="_blank"><style>${HTML_PREVIEW_STYLES}</style></head><body dir="auto">${html}</body></html>`;
  return (
    <iframe
      title="HTML preview"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className={className ?? "h-full w-full rounded-md border bg-white"}
    />
  );
}

/** Cell text; HTML shows as readable text with a badge (full preview is in the popup). */
export function CellText({ text }: { text: string }) {
  const html = looksLikeHtml(text);
  const display = useMemo(() => (html ? htmlToPlainText(text) : text), [html, text]);
  if (!html) return <>{text}</>;
  return (
    <>
      <span className="mr-1 inline-block rounded bg-sky-100 px-1 align-middle font-mono text-[9px] font-semibold uppercase text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
        HTML
      </span>
      {display}
    </>
  );
}

/** Full-value cell popup: view, edit and — for HTML values — preview. */
export function CellTextDialog({
  title,
  value,
  isEditable,
  maxChars,
  listMode,
  onSave,
  onClose,
}: {
  title: string;
  value: string;
  isEditable: boolean;
  maxChars?: number;
  /** Edits a string list as one item per line. */
  listMode?: boolean;
  onSave?: (next: string) => void;
  onClose: () => void;
}) {
  const canEdit = isEditable && !!onSave;
  const [draft, setDraft] = useState(value);
  const isHtml = !listMode && looksLikeHtml(draft);
  const [view, setView] = useState<"preview" | "code" | "split">(() =>
    !listMode && looksLikeHtml(value) ? "preview" : "code"
  );
  const save = () => {
    if (draft !== value) onSave?.(draft);
    onClose();
  };

  const editor = (
    <textarea
      autoFocus={canEdit && (!isHtml || view !== "preview")}
      readOnly={!canEdit}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (canEdit && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          save();
        }
      }}
      placeholder={canEdit ? "Type a value…" : undefined}
      spellCheck={!isHtml}
      className={`w-full rounded-md border bg-background p-3 leading-relaxed outline-none focus:ring-1 focus:ring-primary/50 read-only:bg-muted/30 ${
        isHtml ? "h-full resize-none font-mono text-[11px]" : "min-h-[45vh] resize-y text-xs"
      }`}
    />
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={isHtml ? "sm:max-w-5xl" : "sm:max-w-2xl"}>
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8">
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-sm">{title}</DialogTitle>
            {listMode && canEdit && (
              <DialogDescription className="text-xs">One item per line.</DialogDescription>
            )}
          </div>
          {isHtml && (
            <div className="flex shrink-0 items-center rounded-lg bg-muted p-0.5" role="tablist">
              {(
                [
                  { id: "preview", label: "Preview" },
                  { id: "code", label: "HTML" },
                  { id: "split", label: "Split" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={view === tab.id}
                  onClick={() => setView(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    view === tab.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>
        {!isHtml ? (
          editor
        ) : (
          <div className={`h-[60vh] ${view === "split" ? "grid grid-cols-2 gap-3" : ""}`}>
            {view !== "preview" && editor}
            {view !== "code" && <HtmlPreview html={draft} />}
          </div>
        )}
        <DialogFooter className="flex-row items-center sm:justify-between">
          <span
            className={`mr-auto font-mono text-[10px] ${
              maxChars != null && draft.length > maxChars
                ? "font-semibold text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {draft.length}
            {maxChars != null ? ` / ${maxChars}` : ""} characters
          </span>
          <div className="flex items-center gap-2">
            {canEdit && (
              <span className="hidden text-[10px] text-muted-foreground sm:inline">
                Ctrl+Enter to save
              </span>
            )}
            <Button variant="outline" size="sm" onClick={onClose}>
              {canEdit ? "Cancel" : "Close"}
            </Button>
            {canEdit && (
              <Button size="sm" onClick={save} disabled={draft === value}>
                Save
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

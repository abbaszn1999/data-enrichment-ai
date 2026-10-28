"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ClipboardList, Download, FolderOpen, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLAN_TAB_PREFIX, storeAgentApi, type ChatFile, type Plan } from "./api";
import { FileKindIcon } from "./blocks";
import { Markdown } from "./markdown";

/** Minimal RFC 4180 CSV parser: quotes, escaped quotes, newlines inside quotes. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function toTable(file: ChatFile, text: string): { columns: string[]; rows: string[][] } | null {
  const isCsv = /csv|tab-separated/.test(file.mime) || /\.(csv|tsv)$/i.test(file.name);
  if (isCsv) {
    const parsed = parseCsv(text, /tab-separated/.test(file.mime) || /\.tsv$/i.test(file.name) ? "\t" : ",");
    if (!parsed.length) return null;
    return { columns: parsed[0]!, rows: parsed.slice(1) };
  }
  try {
    const data = JSON.parse(text) as unknown;
    const list = Array.isArray(data) ? data : null;
    if (!list || !list.length || typeof list[0] !== "object" || list[0] === null) return null;
    const columns = Array.from(new Set(list.slice(0, 200).flatMap((r) => Object.keys(r as object))));
    return {
      columns,
      rows: list.map((r) =>
        columns.map((c) => {
          const v = (r as Record<string, unknown>)[c];
          return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        })
      ),
    };
  } catch {
    return null;
  }
}

function TableView({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.some((c) => c.toLowerCase().includes(q))) : rows;
  }, [rows, query]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: filtered.length, getScrollElement: () => scrollRef.current, estimateSize: () => 34, overscan: 12 });
  const template = `48px repeat(${columns.length}, minmax(140px, 1fr))`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search rows"
            className="h-7 w-full rounded-md border bg-background ps-7 pe-2 text-[12px] outline-none focus:ring-2 focus:ring-[#6B358D]/20"
          />
        </div>
        <span className="text-[11.5px] text-muted-foreground">
          {filtered.length.toLocaleString()} {filtered.length === 1 ? "row" : "rows"} · {columns.length} columns
        </span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth: 48 + columns.length * 140 }}>
          <div className="sticky top-0 z-10 grid border-b bg-muted/80 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur" style={{ gridTemplateColumns: template }}>
            <div className="px-2 py-2 text-end">#</div>
            {columns.map((c, i) => (
              <div key={`${c}-${i}`} dir="auto" className="truncate px-2 py-2">
                {c}
              </div>
            ))}
          </div>
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((item) => {
              const row = filtered[item.index]!;
              return (
                <div
                  key={item.key}
                  className="absolute inset-x-0 grid border-b text-[12.5px] hover:bg-muted/40"
                  style={{ gridTemplateColumns: template, transform: `translateY(${item.start}px)`, height: item.size }}
                >
                  <div className="px-2 py-2 text-end tabular-nums text-muted-foreground">{item.index + 1}</div>
                  {columns.map((_, ci) => (
                    <div key={ci} dir="auto" title={row[ci]} className="truncate px-2 py-2">
                      {row[ci] ?? ""}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

type GalleryItem = { image: string; title: string; lines: string[]; link?: string };

const IMAGE_KEYS = ["image", "imageUrl", "image_url", "featured_image", "featuredImage", "img", "thumbnail"];
const TITLE_KEYS = ["title", "name", "product", "label"];
const LINK_KEYS = ["page", "link", "url", "adminUrl", "admin_url"];

/** A JSON array of objects that carry an image URL reads best as a gallery. */
function toGallery(text: string): GalleryItem[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || !data.length || data.length > 2000) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  const imageKey = IMAGE_KEYS.find((k) => typeof (first as Record<string, unknown>)[k] === "string");
  if (!imageKey) return null;
  return (data as Array<Record<string, unknown>>).map((row) => {
    const titleKey = TITLE_KEYS.find((k) => typeof row[k] === "string");
    const linkKey = LINK_KEYS.find((k) => typeof row[k] === "string" && /^https?:\/\//.test(String(row[k])));
    const lines = Object.entries(row)
      .filter(([k, v]) => k !== imageKey && k !== titleKey && k !== linkKey && v !== null && v !== "" && typeof v !== "object")
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${String(v)}`);
    return { image: String(row[imageKey] ?? ""), title: titleKey ? String(row[titleKey]) : "", lines, link: linkKey ? String(row[linkKey]) : undefined };
  });
}

function GalleryView({ items }: { items: GalleryItem[] }) {
  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {items.map((item, i) => (
          <div key={`${item.image}-${i}`} className="group overflow-hidden rounded-xl border bg-background shadow-sm transition-shadow hover:shadow-md">
            <div className="relative aspect-square bg-[repeating-conic-gradient(#8881_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
                onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.15")}
              />
              <span className="absolute start-2 top-2 rounded-md bg-background/85 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums shadow-sm">{i + 1}</span>
            </div>
            <div className="space-y-0.5 p-2.5">
              {item.title && (
                <div dir="auto" className="line-clamp-2 text-[12.5px] font-semibold leading-snug">
                  {item.title}
                </div>
              )}
              {item.lines.map((line) => (
                <div key={line} dir="auto" className="truncate text-[11px] text-muted-foreground">
                  {line}
                </div>
              ))}
              {item.link && (
                <a href={item.link} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-[11px] text-[#6B358D] hover:underline dark:text-[#F76D01]">
                  {new URL(item.link).hostname}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileViewer({ workspaceId, file }: { workspaceId: string; file: ChatFile }) {
  const [asTable, setAsTable] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isText = /^(text\/|application\/json)/.test(file.mime);
  const url = storeAgentApi.fileUrl(workspaceId, file.id);

  useEffect(() => {
    if (!isText) return;
    let alive = true;
    storeAgentApi
      .fileText(workspaceId, file.id)
      .then((r) => alive && setText(r.text))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [workspaceId, file.id, file.size, isText]);

  if (file.mime.startsWith("image/")) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(#8881_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={file.name} className="max-h-full max-w-full rounded-lg object-contain shadow-lg" />
      </div>
    );
  }
  if (file.mime === "application/pdf") return <iframe src={url} title={file.name} className="h-full w-full border-0" />;
  if (!isText) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        This file cannot be previewed.
        <a href={storeAgentApi.fileUrl(workspaceId, file.id, true)} className="font-medium text-[#6B358D] hover:underline dark:text-[#F76D01]">
          Download {file.name}
        </a>
      </div>
    );
  }
  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>;
  if (text === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const gallery = /json/.test(file.mime) || /\.json$/i.test(file.name) ? toGallery(text) : null;
  const table = toTable(file, text);
  if (gallery && !asTable) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b px-3 py-1.5 text-[11.5px] text-muted-foreground">
          <span>{gallery.length} items</span>
          {table && (
            <button type="button" onClick={() => setAsTable(true)} className="font-medium hover:text-foreground">
              Show as table
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <GalleryView items={gallery} />
        </div>
      </div>
    );
  }
  if (table) return <TableView {...table} />;
  if (file.mime === "text/html" || /\.html?$/i.test(file.name)) return <HtmlView html={text} name={file.name} />;
  if (file.mime === "text/markdown" || /\.md$/i.test(file.name)) {
    return (
      <div className="h-full overflow-auto px-8 py-6">
        <Markdown text={text} className="prose-base mx-auto max-w-3xl" />
      </div>
    );
  }
  return (
    <pre dir="auto" className="h-full overflow-auto whitespace-pre-wrap px-6 py-5 font-mono text-[12.5px] leading-relaxed">
      {file.mime === "application/json" ? safePretty(text) : text}
    </pre>
  );
}

/**
 * An HTML report the agent wrote, shown as the page it describes. It runs in
 * a sandboxed frame with an opaque origin: its scripts (charts) work, but
 * cannot reach the app, its cookies or the page around it. Links open in a
 * new tab rather than inside the frame.
 */
function HtmlView({ html, name }: { html: string; name: string }) {
  const [showCode, setShowCode] = useState(false);
  const doc = /<base\s/i.test(html) ? html : html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base target="_blank">`);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-1 border-b px-3 py-1.5 text-[11.5px]">
        {(["Preview", "Code"] as const).map((label) => {
          const active = (label === "Code") === showCode;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setShowCode(label === "Code")}
              className={cn("rounded-md px-2 py-0.5 font-medium", active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          );
        })}
      </div>
      {showCode ? (
        <pre dir="ltr" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-6 py-5 font-mono text-[12px] leading-relaxed">
          {html}
        </pre>
      ) : (
        <iframe
          title={name}
          srcDoc={doc}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      )}
    </div>
  );
}

function safePretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

type PanelTab = { id: string; name: string; icon: ReactNode; file?: ChatFile; plan?: Plan };

export function FilePanel({
  workspaceId,
  files,
  plans,
  renderPlan,
  openFileIds,
  activeFileId,
  working,
  onOpen,
  onClose,
}: {
  workspaceId: string;
  files: ChatFile[];
  /** Plans from Plan mode; their tabs use PLAN_TAB_PREFIX ids. */
  plans: Plan[];
  renderPlan: (plan: Plan) => ReactNode;
  openFileIds: string[];
  activeFileId: string | null;
  /** The agent is running: the empty workspace says results are on the way. */
  working: boolean;
  onOpen: (fileId: string) => void;
  onClose: (fileId: string) => void;
}) {
  const tabs = new Map<string, PanelTab>();
  for (const f of files) tabs.set(f.id, { id: f.id, name: f.name, file: f, icon: <FileKindIcon kind={f.kind} mime={f.mime} className="h-3.5 w-3.5 shrink-0" /> });
  for (const p of plans) {
    const id = PLAN_TAB_PREFIX + p.id;
    tabs.set(id, { id, name: p.title, plan: p, icon: <ClipboardList className="h-3.5 w-3.5 shrink-0 text-[#6B358D] dark:text-[#F76D01]" /> });
  }
  const open = openFileIds.map((id) => tabs.get(id)).filter(Boolean) as PanelTab[];
  const activeTab = activeFileId ? tabs.get(activeFileId) : undefined;
  const active = activeTab?.file;
  const [showList, setShowList] = useState(false);
  // A file opened from the chat (or by the agent) takes over from the list.
  const [seenActive, setSeenActive] = useState(activeFileId);
  if (seenActive !== activeFileId) {
    setSeenActive(activeFileId);
    setShowList(false);
  }
  const listing = showList || !activeTab;
  const isStoreData = (f: ChatFile) => /^(shopify-results|woo-results|exports|previews|backups|results)\//.test(f.path);
  const agentFiles = files.filter((f) => f.created_by === "agent" && !isStoreData(f));
  const uploads = files.filter((f) => f.created_by === "user");
  const results = files.filter((f) => f.created_by === "agent" && isStoreData(f) && !f.path.startsWith("backups/"));

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/10">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background/70 px-2">
        <button
          type="button"
          onClick={() => setShowList(true)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors",
            listing ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Files {files.length > 0 && <span className="text-muted-foreground">{files.length}</span>}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {open.map((tab) => {
            const selected = !listing && tab.id === activeFileId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "group flex h-7 max-w-[200px] shrink-0 items-center gap-1.5 rounded-md ps-2 pe-1 text-[12px] transition-colors",
                  selected ? "bg-background font-medium shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowList(false);
                    onOpen(tab.id);
                  }}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  {tab.icon}
                  <span dir="auto" className="truncate">
                    {tab.name}
                  </span>
                </button>
                <button type="button" aria-label={`Close ${tab.name}`} onClick={() => onClose(tab.id)} className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        {active && !listing && (
          <a
            href={storeAgentApi.fileUrl(workspaceId, active.id, true)}
            aria-label="Download"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {listing ? (
          <div className="h-full overflow-auto p-4">
            {files.length === 0 && plans.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="relative mb-5 h-28 w-44">
                  <div className="absolute inset-0 rotate-[-6deg] rounded-xl border bg-background shadow-sm" />
                  <div className="absolute inset-0 rotate-[4deg] rounded-xl border bg-background shadow-sm" />
                  <div className="absolute inset-0 flex flex-col gap-1.5 rounded-xl border bg-background p-3 shadow-md">
                    <div className={cn("h-2 w-2/3 rounded-full bg-muted", working && "animate-pulse")} />
                    <div className={cn("h-2 w-full rounded-full bg-muted/70", working && "animate-pulse [animation-delay:150ms]")} />
                    <div className={cn("h-2 w-5/6 rounded-full bg-muted/70", working && "animate-pulse [animation-delay:300ms]")} />
                    <div className="mt-auto grid grid-cols-3 gap-1">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className={cn("h-6 rounded-md bg-muted/60", working && "animate-pulse")} style={{ animationDelay: `${i * 120}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
                <p className={cn("text-sm font-semibold", working ? "assistant-shimmer" : "text-muted-foreground")}>
                  {working ? "Vera is working…" : "Your workspace"}
                </p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground/70">
                  {working
                    ? "Reports, tables and images will open here as soon as they are ready."
                    : "Reports, plans, product tables and images the agent creates open here."}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {plans.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Plans</div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {plans.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => {
                            setShowList(false);
                            onOpen(PLAN_TAB_PREFIX + plan.id);
                          }}
                          className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-start transition-colors hover:border-[#6B358D]/40 hover:bg-[#400095]/[0.03] dark:hover:border-[#F76D01]/40"
                        >
                          <ClipboardList className="h-4 w-4 shrink-0 text-[#6B358D] dark:text-[#F76D01]" />
                          <div className="min-w-0">
                            <div dir="auto" className="truncate text-[12.5px] font-medium">
                              {plan.title}
                            </div>
                            <div className="truncate text-[11px] capitalize text-muted-foreground">
                              {plan.status}
                              {plan.version > 1 ? ` · version ${plan.version}` : ""}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {[
                  { title: "Created by the agent", list: agentFiles },
                  { title: "Your attachments", list: uploads },
                  { title: "Store data", list: results },
                ]
                  .filter((g) => g.list.length)
                  .map((group) => (
                    <div key={group.title}>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</div>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {group.list.map((file) => {
                          return (
                            <button
                              key={file.id}
                              type="button"
                              onClick={() => {
                                setShowList(false);
                                onOpen(file.id);
                              }}
                              className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-start transition-colors hover:border-[#6B358D]/40 hover:bg-[#400095]/[0.03] dark:hover:border-[#F76D01]/40"
                            >
                              <FileKindIcon kind={file.kind} mime={file.mime} className="h-4 w-4 shrink-0 text-[#6B358D] dark:text-[#F76D01]" />
                              <div className="min-w-0">
                                <div className="truncate text-[12.5px] font-medium">{file.name}</div>
                                <div className="truncate text-[11px] text-muted-foreground">{file.path}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        ) : activeTab?.plan ? (
          renderPlan(activeTab.plan)
        ) : (
          active && <FileViewer key={active.id} workspaceId={workspaceId} file={active} />
        )}
      </div>
    </div>
  );
}

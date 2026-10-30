"use client";

import { useMemo, useState, type ComponentType } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Paperclip,
  Search,
  Table2,
  Wrench,
  X,
} from "lucide-react";
import { FILE_SECTIONS, fileSection, isExtractedImage, type FileSectionId } from "@/lib/store-agent/file-kinds";
import { cn } from "@/lib/utils";
import { PLAN_TAB_PREFIX, storeAgentApi, type ChatFile, type Plan } from "./api";
import { FileKindIcon } from "./blocks";

type FolderMeta = {
  icon: ComponentType<{ className?: string }>;
  /** Folder tint: the folder glyph and its badge. */
  tint: string;
  /** What appears here, for an empty folder. */
  empty: string;
};

const FOLDERS: Record<FileSectionId, FolderMeta> = {
  reports: { icon: FileText, tint: "text-[#6B358D] dark:text-[#B98BE0]", empty: "Reports Vera writes for you appear here." },
  tables: { icon: Table2, tint: "text-sky-600 dark:text-sky-400", empty: "Tables and product galleries appear here." },
  excel: { icon: FileSpreadsheet, tint: "text-emerald-600 dark:text-emerald-400", empty: "Excel files Vera makes for you to download appear here." },
  images: { icon: ImageIcon, tint: "text-rose-500 dark:text-rose-400", empty: "Images Vera creates or finds appear here." },
  plans: { icon: ClipboardList, tint: "text-[#F76D01]", empty: "Plans from Plan mode appear here." },
  uploads: { icon: Paperclip, tint: "text-amber-600 dark:text-amber-400", empty: "Files you attach to the chat appear here." },
  working: { icon: Wrench, tint: "text-muted-foreground", empty: "Files Vera uses while she works appear here." },
};

type Entry = {
  key: string;
  /** What opens: a file id, or a plan tab id. */
  openId: string;
  name: string;
  /** "v2" when the same name is in the folder more than once. */
  version?: string;
  detail: string;
  /** Searched besides the name. */
  haystack: string;
  file?: ChatFile;
  createdAt: number;
  section: FileSectionId;
};

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

/** "just now", "5 minutes ago", "3 hours ago", then the date. */
export function timeAgo(at: number, now: number): string {
  const seconds = Math.max(0, (now - at) / 1000);
  if (!rtf || Number.isNaN(seconds)) return "";
  if (seconds < 45) return "just now";
  if (seconds < 3600) return rtf.format(-Math.max(1, Math.round(seconds / 60)), "minute");
  if (seconds < 86_400) return rtf.format(-Math.round(seconds / 3600), "hour");
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Group a chat's files and plans into the fixed folders, newest first, with versions for repeated names. */
export function buildSections(files: ChatFile[], plans: Plan[], now: number): Map<FileSectionId, Entry[]> {
  const sections = new Map<FileSectionId, Entry[]>(FILE_SECTIONS.map((s) => [s.id, []]));
  for (const file of files) {
    const section = fileSection(file);
    if (!section) continue;
    const at = Date.parse(file.created_at) || now;
    sections.get(section)!.push({
      key: file.id,
      openId: file.id,
      name: file.name,
      detail: [timeAgo(at, now), file.request].filter(Boolean).join(" · "),
      haystack: `${file.name} ${file.path} ${file.request ?? ""}`.toLowerCase(),
      file,
      createdAt: at,
      section,
    });
  }
  for (const plan of plans) {
    const at = Date.parse(plan.updated_at) || now;
    sections.get("plans")!.push({
      key: plan.id,
      openId: PLAN_TAB_PREFIX + plan.id,
      name: plan.title,
      detail: [timeAgo(at, now), plan.status === "draft" ? "Draft" : plan.status === "building" ? "Building" : "Built", plan.version > 1 ? `version ${plan.version}` : ""]
        .filter(Boolean)
        .join(" · "),
      haystack: `${plan.title} ${plan.content.slice(0, 2000)}`.toLowerCase(),
      createdAt: at,
      section: "plans",
    });
  }
  for (const [, entries] of sections) {
    // Same name more than once (uploaded twice, rewritten under a new folder): number them, oldest first.
    const byName = new Map<string, Entry[]>();
    for (const e of entries) byName.set(e.name.toLowerCase(), [...(byName.get(e.name.toLowerCase()) ?? []), e]);
    for (const same of byName.values()) {
      if (same.length < 2) continue;
      [...same].sort((a, b) => a.createdAt - b.createdAt).forEach((e, i) => (e.version = `v${i + 1}`));
    }
    entries.sort((a, b) => b.createdAt - a.createdAt);
  }
  return sections;
}

const TITLE = Object.fromEntries(FILE_SECTIONS.map((s) => [s.id, s.title])) as Record<FileSectionId, string>;
const VIEW_KEY = "store-agent:files-view";

function readView(): "grid" | "list" {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function EntryIcon({ entry, workspaceId, large }: { entry: Entry; workspaceId: string; large?: boolean }) {
  const box = large ? "h-20 w-full" : "h-8 w-8";
  if (entry.file?.mime.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={storeAgentApi.fileUrl(workspaceId, entry.file.id)}
        alt=""
        loading="lazy"
        className={cn(box, "shrink-0 rounded-md border bg-muted object-cover")}
      />
    );
  }
  const Icon = FOLDERS[entry.section].icon;
  return (
    <span className={cn(box, "flex shrink-0 items-center justify-center rounded-md bg-muted/60", FOLDERS[entry.section].tint)}>
      {entry.file ? <FileKindIcon kind={entry.file.kind} mime={entry.file.mime} className={large ? "h-7 w-7" : "h-4 w-4"} /> : <Icon className={large ? "h-7 w-7" : "h-4 w-4"} />}
    </span>
  );
}

/**
 * The chat's files as a small file explorer: the fixed folders (Reports,
 * Tables, Excel, Images, Plans, Uploads, Working files) on top, each opened
 * like a folder on a computer, with a path back up and one search.
 */
export function FileBrowser({
  workspaceId,
  files,
  plans,
  folder,
  onFolder,
  onOpen,
}: {
  workspaceId: string;
  files: ChatFile[];
  plans: Plan[];
  /** The folder being looked at; null for the top. Kept by the panel, so a file opened from here returns to it. */
  folder: FileSectionId | null;
  onFolder: (folder: FileSectionId | null) => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">(readView);
  const [now] = useState(() => Date.now());
  const sections = useMemo(() => buildSections(files, plans, now), [files, plans, now]);
  const q = query.trim().toLowerCase();

  const go = (next: FileSectionId | null) => {
    setQuery("");
    onFolder(next);
  };
  const changeView = (next: "grid" | "list") => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // the choice just is not remembered
    }
  };

  // Searching from the top looks in every folder, and in the tables made from uploads.
  const results = useMemo((): Entry[] => {
    if (!q) return [];
    const scope = folder ? (sections.get(folder) ?? []) : [...sections.values()].flat();
    const found = scope.filter((e) => e.haystack.includes(q) || e.name.toLowerCase().includes(q));
    if (folder && folder !== "uploads") return found;
    const madeFromUploads = files
      .filter((f) => f.path.startsWith("attachments/") && f.created_by === "agent" && !isExtractedImage(f.path))
      .filter((f) => `${f.name} ${f.path}`.toLowerCase().includes(q))
      .map((f): Entry => ({ key: f.id, openId: f.id, name: f.name, detail: f.path, haystack: "", file: f, createdAt: Date.parse(f.created_at) || now, section: "uploads" }));
    return [...found, ...madeFromUploads];
  }, [q, folder, sections, files, now]);

  const entries = q ? results : folder ? (sections.get(folder) ?? []) : [];
  const showFolders = !folder && !q;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Path, search and view */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background/60 px-4 py-2.5">
        {folder && (
          <button
            type="button"
            onClick={() => go(null)}
            aria-label="Back to all folders"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </button>
        )}
        <nav aria-label="Folder path" className="flex min-w-0 items-center gap-1 text-[13px]">
          <button
            type="button"
            onClick={() => go(null)}
            className={cn("rounded px-1 font-semibold", folder ? "text-muted-foreground hover:text-foreground" : "text-foreground")}
          >
            Files
          </button>
          {folder && (
            <>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
              <span className="truncate px-1 font-semibold">{TITLE[folder]}</span>
            </>
          )}
        </nav>
        <div className="relative ms-auto w-full max-w-xs min-w-[160px] flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={folder ? `Search ${TITLE[folder]}` : "Search all files"}
            aria-label={folder ? `Search ${TITLE[folder]}` : "Search all files"}
            dir="auto"
            className="h-8 w-full rounded-lg border bg-background ps-8 pe-7 text-[12.5px] outline-none focus:ring-2 focus:ring-[#6B358D]/20 dark:focus:ring-[#F76D01]/20"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute end-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {!showFolders && (
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => changeView(v)}
                aria-label={v === "grid" ? "Grid view" : "List view"}
                aria-pressed={view === v}
                className={cn("flex h-6 w-6 items-center justify-center rounded-md", view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "grid" ? <LayoutGrid className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {showFolders ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {FILE_SECTIONS.map((s) => {
              const list = sections.get(s.id) ?? [];
              const meta = FOLDERS[s.id];
              const Icon = meta.icon;
              const latest = list[0];
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(s.id)}
                  className={cn(
                    "group flex flex-col items-center gap-2 rounded-xl border bg-background px-3 pb-3 pt-4 text-center transition-all hover:-translate-y-0.5 hover:border-[#6B358D]/40 hover:shadow-md dark:hover:border-[#F76D01]/40",
                    !list.length && "opacity-60",
                    s.id === "working" && "border-dashed"
                  )}
                >
                  <span className="relative">
                    <Folder className={cn("h-14 w-14 fill-current opacity-20", meta.tint)} strokeWidth={1} />
                    <Folder className={cn("absolute inset-0 h-14 w-14", meta.tint)} strokeWidth={1.25} />
                    <Icon className={cn("absolute bottom-2.5 start-1/2 h-4 w-4 -translate-x-1/2 rtl:translate-x-1/2", meta.tint)} />
                  </span>
                  <span className="text-[13px] font-semibold">{s.title}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {list.length ? `${list.length} ${list.length === 1 ? "item" : "items"}${latest ? ` · ${timeAgo(latest.createdAt, now)}` : ""}` : "Empty"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[12.5px] text-muted-foreground">
            {q ? (
              <>Nothing matches “{query.trim()}”{folder ? ` in ${TITLE[folder]}` : ""}.</>
            ) : (
              <>
                <Folder className={cn("h-10 w-10", FOLDERS[folder!].tint)} strokeWidth={1.25} />
                {FOLDERS[folder!].empty}
              </>
            )}
          </div>
        ) : (
          <>
            {folder === "working" && !q && (
              <p className="mb-3 rounded-lg bg-muted/50 px-3 py-2 text-[11.5px] text-muted-foreground">
                Files Vera uses while she works: raw store data and intermediate steps. Your results are in the other folders.
              </p>
            )}
            {view === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                {entries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    title={entry.file?.path ?? entry.name}
                    onClick={() => onOpen(entry.openId)}
                    className="flex min-w-0 flex-col gap-2 rounded-xl border bg-background p-2.5 text-start transition-all hover:-translate-y-0.5 hover:border-[#6B358D]/40 hover:shadow-md dark:hover:border-[#F76D01]/40"
                  >
                    <EntryIcon entry={entry} workspaceId={workspaceId} large />
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span dir="auto" className="truncate text-[12.5px] font-medium">
                          {entry.name}
                        </span>
                        {entry.version && <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">{entry.version}</span>}
                      </span>
                      <span dir="auto" className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {q && !folder ? `${TITLE[entry.section]} · ${entry.detail}` : entry.detail}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-background">
                {entries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    title={entry.file?.path ?? entry.name}
                    onClick={() => onOpen(entry.openId)}
                    className="flex w-full min-w-0 items-center gap-3 border-b px-3 py-2 text-start last:border-b-0 hover:bg-muted/50"
                  >
                    <EntryIcon entry={entry} workspaceId={workspaceId} />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span dir="auto" className="truncate text-[12.5px] font-medium">
                        {entry.name}
                      </span>
                      {entry.version && <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">{entry.version}</span>}
                    </span>
                    {q && !folder && <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{TITLE[entry.section]}</span>}
                    <span dir="auto" className="hidden max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground md:inline">
                      {entry.detail}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState, type ComponentType } from "react";
import { ChevronRight, ClipboardList, FileSpreadsheet, FileText, Image as ImageIcon, Paperclip, Search, Table2, Wrench, X } from "lucide-react";
import { FILE_SECTIONS, fileSection, isExtractedImage, type FileSectionId } from "@/lib/store-agent/file-kinds";
import { cn } from "@/lib/utils";
import { PLAN_TAB_PREFIX, storeAgentApi, type ChatFile, type Plan } from "./api";
import { FileKindIcon } from "./blocks";

const SECTION_ICON: Record<FileSectionId, ComponentType<{ className?: string }>> = {
  reports: FileText,
  tables: Table2,
  excel: FileSpreadsheet,
  images: ImageIcon,
  plans: ClipboardList,
  uploads: Paperclip,
  working: Wrench,
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
    const when = timeAgo(at, now);
    sections.get(section)!.push({
      key: file.id,
      openId: file.id,
      name: file.name,
      detail: [when, file.request].filter(Boolean).join(" · "),
      haystack: `${file.name} ${file.path} ${file.request ?? ""}`.toLowerCase(),
      file,
      createdAt: at,
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

/**
 * The chat's files in fixed folders (Reports, Tables, Excel, Images, Plans,
 * Uploads, then Working files folded away), with one search across them.
 */
export function FileBrowser({
  workspaceId,
  files,
  plans,
  onOpen,
}: {
  workspaceId: string;
  files: ChatFile[];
  plans: Plan[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<FileSectionId>>(() => new Set(["working"]));
  const [now] = useState(() => Date.now());
  const sections = useMemo(() => buildSections(files, plans, now), [files, plans, now]);
  const q = query.trim().toLowerCase();

  // Searching also finds what was made from an upload (its tables), not only what is listed.
  const extra = useMemo((): Entry[] => {
    if (!q) return [];
    return files
      .filter((f) => f.path.startsWith("attachments/") && f.created_by === "agent" && !isExtractedImage(f.path))
      .filter((f) => `${f.name} ${f.path}`.toLowerCase().includes(q))
      .map((f) => ({ key: f.id, openId: f.id, name: f.name, detail: f.path, haystack: "", file: f, createdAt: Date.parse(f.created_at) || now }));
  }, [files, q, now]);

  const visible = FILE_SECTIONS.map((s) => {
    const all = sections.get(s.id) ?? [];
    const entries = q ? [...all.filter((e) => e.haystack.includes(q)), ...(s.id === "uploads" ? extra : [])] : all;
    return { ...s, entries, total: all.length };
  }).filter((s) => s.entries.length > 0);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files and plans"
          aria-label="Search files and plans"
          dir="auto"
          className="h-8 w-full rounded-lg border bg-background ps-8 pe-8 text-[12.5px] outline-none focus:ring-2 focus:ring-[#6B358D]/20 dark:focus:ring-[#F76D01]/20"
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

      {q && visible.length === 0 && <p className="px-1 text-[12.5px] text-muted-foreground">Nothing matches “{query.trim()}”.</p>}

      {visible.map((section) => {
        const Icon = SECTION_ICON[section.id];
        // A search opens every folder it found something in.
        const open = q ? true : !closed.has(section.id);
        return (
          <section key={section.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() =>
                setClosed((c) => {
                  const next = new Set(c);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                })
              }
              className="mb-1.5 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-start text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
              <Icon className="h-3.5 w-3.5" />
              {section.title}
              <span className="font-medium normal-case tracking-normal text-muted-foreground/70">{q ? `${section.entries.length} of ${section.total}` : section.total}</span>
            </button>
            {open && section.id === "working" && !q && (
              <p className="mb-2 px-1 text-[11.5px] text-muted-foreground">Files Vera uses while she works (raw store data, intermediate steps). Your results are above.</p>
            )}
            {open && (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {section.entries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    title={entry.file?.path ?? entry.name}
                    onClick={() => onOpen(entry.openId)}
                    className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-start transition-colors hover:border-[#6B358D]/40 hover:bg-[#400095]/[0.03] dark:hover:border-[#F76D01]/40"
                  >
                    {entry.file?.mime.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={storeAgentApi.fileUrl(workspaceId, entry.file.id)} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-md border bg-muted object-cover" />
                    ) : entry.file ? (
                      <FileKindIcon kind={entry.file.kind} mime={entry.file.mime} className="h-4 w-4 shrink-0 text-[#6B358D] dark:text-[#F76D01]" />
                    ) : (
                      <ClipboardList className="h-4 w-4 shrink-0 text-[#6B358D] dark:text-[#F76D01]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span dir="auto" className="truncate text-[12.5px] font-medium">
                          {entry.name}
                        </span>
                        {entry.version && (
                          <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">{entry.version}</span>
                        )}
                      </div>
                      {entry.detail && (
                        <div dir="auto" className="truncate text-[11px] text-muted-foreground">
                          {entry.detail}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

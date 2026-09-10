"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Compass,
  Loader2,
  MoreVertical,
  Play,
  Plus,
  Store,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import type { NicheReading } from "./mock-data";

type StageScopePanelProps = {
  projectId: string;
  storeLabel: string;
  phase: "pending" | "running" | "done";
  onStartAnalysis?: () => void;
  /** Show Next only after Stage 1 is complete. */
  showNext?: boolean;
  nextLabel?: string;
  onNext?: () => void;
  nextDisabled?: boolean;
  /** Progress of the running read, 0–1. */
  progress?: number;
  onCancelAnalysis?: () => void;
  /** Editable niche read — cheaper than asking for a full re-crawl. */
  niches: NicheReading[];
  onRenameNiche: (id: string, name: string) => void;
  onDeleteNiche: (id: string) => void;
  onAddNiche: (name: string) => void;
  onMergeNiche: (sourceId: string, targetId: string) => void;
  readOnly?: boolean;
};

/**
 * Stage 1 results — parent niches only (what the site seems to sell).
 * No collections / product counts. Next advances when the customer is ready.
 */
export function StageScopePanel({
  projectId,
  storeLabel,
  phase,
  onStartAnalysis,
  showNext = false,
  nextLabel = "Next",
  onNext,
  nextDisabled = false,
  progress = 0,
  onCancelAnalysis,
  niches,
  onRenameNiche,
  onDeleteNiche,
  onAddNiche,
  onMergeNiche,
  readOnly = false,
}: StageScopePanelProps) {
  const [revealedCount, setRevealedCount] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newNiche, setNewNiche] = useState("");

  useEffect(() => {
    if (phase !== "done") {
      setRevealedCount(0);
      return;
    }
    setRevealedCount(niches.length);
  }, [phase, projectId, niches.length, readOnly]);

  if (phase === "pending") {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Store className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold tracking-tight">
              Website not analyzed yet
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Stage 1 asks the agent to read{" "}
              <span className="font-medium text-foreground/80">{storeLabel}</span>{" "}
              and say what broad niches it seems to sell — not categories or
              counts.
            </p>
          </div>
          {onStartAnalysis ? (
            <Button
              type="button"
              size="sm"
              className="gap-2"
              onClick={onStartAnalysis}
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Start analysis
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-4 py-10">
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Compass className="h-6 w-6 text-primary" />
            <span className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            </span>
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">
              Reading the website
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The agent is still figuring out what this store sells. Niche
              findings will appear here when the read finishes — follow the
              conversation on the left.
            </p>
          </div>
          <div className="w-full max-w-[220px] space-y-2">
            <Progress
              value={Math.round(Math.min(1, Math.max(0, progress)) * 100)}
              className="h-1"
              aria-label="Website read progress"
            />
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {Math.round(Math.min(1, Math.max(0, progress)) * 100)}% · reading
              navigation and collection pages
            </p>
          </div>
          {onCancelAnalysis ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-2 text-xs text-muted-foreground"
              onClick={onCancelAnalysis}
            >
              <X className="h-3.5 w-3.5" />
              Stop this read
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold tracking-tight">
              Parent niches
            </h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              First read complete
            </span>
          </div>
          <p className="text-xs text-muted-foreground max-w-xl leading-relaxed">
            What the site appears to sell at a high level. Discuss freely with
            the agent — when you agree, continue with Next. Categories and
            product counts stay for the next stage.
          </p>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
            Read from {storeLabel}: site navigation, category pages and existing
            collection pages. No recommendation yet — only what already exists.
          </p>
        </div>

        <div className="space-y-3">
          {niches.map((niche, index) =>
            index < revealedCount ? (
              <article
                key={niche.id}
                className="rounded-2xl border border-border/70 bg-card px-4 py-3.5 space-y-1.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
              >
                <div className="flex items-start gap-2">
                  {renamingId === niche.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (renameValue.trim()) {
                            onRenameNiche(niche.id, renameValue.trim());
                          }
                          setRenamingId(null);
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => {
                        if (renameValue.trim()) {
                          onRenameNiche(niche.id, renameValue.trim());
                        }
                        setRenamingId(null);
                      }}
                      className="min-w-0 flex-1 border-b border-foreground/25 bg-transparent pb-0.5 text-sm font-semibold outline-none"
                      aria-label={`Rename ${niche.name}`}
                    />
                  ) : (
                    <h3 className="min-w-0 flex-1 text-sm font-semibold tracking-tight">
                      {niche.name}
                      {niche.edited ? (
                        <span className="ml-2 rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground align-middle">
                          Edited by you
                        </span>
                      ) : null}
                    </h3>
                  )}
                  {readOnly ? null : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Edit ${niche.name}`}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        className="text-xs"
                        onClick={() => {
                          setRenamingId(niche.id);
                          setRenameValue(niche.name);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      {niches
                        .filter((other) => other.id !== niche.id)
                        .map((other) => (
                          <DropdownMenuItem
                            key={other.id}
                            className="text-xs"
                            onClick={() => onMergeNiche(niche.id, other.id)}
                          >
                            Merge into {other.name}
                          </DropdownMenuItem>
                        ))}
                      <DropdownMenuItem
                        className="text-xs text-destructive focus:text-destructive"
                        onClick={() => onDeleteNiche(niche.id)}
                      >
                        Remove niche
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {niche.summary}
                </p>
              </article>
            ) : null
          )}
          {revealedCount === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Opening niche findings…
            </div>
          )}

          {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border/70 px-3 py-2">
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={newNiche}
              onChange={(e) => setNewNiche(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (!newNiche.trim()) return;
                onAddNiche(newNiche.trim());
                setNewNiche("");
              }}
              placeholder="Add a niche I missed…"
              className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              aria-label="Add a parent niche"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={!newNiche.trim()}
              onClick={() => {
                onAddNiche(newNiche.trim());
                setNewNiche("");
              }}
            >
              Add niche
            </Button>
          </div>
          )}
          {readOnly ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Locked after extract — this is the niche read that was agreed.
            </p>
          ) : (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Correcting a name or adding a missing niche here is instant and
            free. Ask for a full re-read only when the crawl itself missed parts
            of the site.
          </p>
          )}
        </div>
      </div>

      {showNext && onNext && !readOnly ? (
        <div className="shrink-0 border-t border-border/70 bg-background/95 pt-3 mt-1 backdrop-blur-sm">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium tracking-tight">
                Ready for catalog scope?
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Next opens Stage 2. The agent keeps working from this niche read
                in the background.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-2 shrink-0 self-stretch sm:self-auto"
              disabled={nextDisabled}
              onClick={onNext}
            >
              {nextLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, Minus, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  clampVisualizerImageCount,
  getVisualizerLayout,
  VISUALIZER_LAYOUT_IDS,
  VISUALIZER_LAYOUTS,
  type VisualizerLayoutId,
} from "@/lib/visualizer/layouts";

type PreviewMode = "structure" | "filled";

/** Soft product-photo stand-ins (not empty gray) for the filled preview. */
const FILL_TONES = [
  "linear-gradient(145deg,#d4d4d8 0%,#a1a1aa 42%,#71717a 100%)",
  "linear-gradient(160deg,#c4b5a5 0%,#8b7355 48%,#5c4632 100%)",
  "linear-gradient(135deg,#b8c4ce 0%,#7a8f9e 50%,#4a5d6a 100%)",
  "linear-gradient(150deg,#c9b8c4 0%,#8f6f82 45%,#5a3f4f 100%)",
  "linear-gradient(140deg,#b5c9b8 0%,#6f8f74 50%,#3f5a44 100%)",
  "linear-gradient(155deg,#cfc6b8 0%,#9a8b72 48%,#5e5340 100%)",
];

function SquareSlot({
  index,
  mode,
  className = "",
}: {
  index: number;
  mode: PreviewMode;
  className?: string;
}) {
  if (mode === "filled") {
    return (
      <div
        className={`relative aspect-square shrink-0 overflow-hidden rounded-md shadow-sm ring-1 ring-black/5 dark:ring-white/10 ${className}`}
        style={{ background: FILL_TONES[index % FILL_TONES.length] }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.35),transparent_55%)] dark:bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.18),transparent_55%)]" />
        <div className="absolute right-1.5 bottom-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-white/90 dark:bg-black/60">
          1:1
        </div>
      </div>
    );
  }
  return (
    <div
      className={`aspect-square shrink-0 rounded-md border border-dashed border-foreground/20 bg-muted-foreground/[0.07] dark:border-foreground/25 dark:bg-muted-foreground/10 ${className}`}
    />
  );
}

function CopyBlock({ dense = false }: { dense?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 py-1">
      <div className="h-2.5 w-[42%] rounded-full bg-foreground/15 dark:bg-foreground/25" />
      <div className="h-1.5 w-full rounded-full bg-foreground/[0.08] dark:bg-foreground/15" />
      <div className="h-1.5 w-[92%] rounded-full bg-foreground/[0.08] dark:bg-foreground/15" />
      {!dense ? (
        <div className="h-1.5 w-[70%] rounded-full bg-foreground/[0.08] dark:bg-foreground/15" />
      ) : null}
    </div>
  );
}

function PageChrome({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_60px_-28px_rgba(0,0,0,0.75)]">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/60 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/25" />
        <span className="ml-2 h-1.5 flex-1 rounded-full bg-muted-foreground/10" />
      </div>
      <div className="max-h-[min(52vh,520px)] overflow-y-auto bg-card p-5 sm:p-6">
        {children}
      </div>
    </div>
  );
}

function LiveLayoutPreview({
  layoutId,
  imageCount,
  mode,
}: {
  layoutId: VisualizerLayoutId;
  imageCount: number;
  mode: PreviewMode;
}) {
  const n = clampVisualizerImageCount(layoutId, imageCount);

  if (layoutId === "zigzag") {
    return (
      <PageChrome>
        <div className="mb-5 h-3 w-1/3 rounded-full bg-foreground/20 dark:bg-foreground/30" />
        <div className="mb-6 space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-foreground/[0.07] dark:bg-foreground/15" />
          <div className="h-1.5 w-4/5 rounded-full bg-foreground/[0.07] dark:bg-foreground/15" />
        </div>
        <div className="space-y-6">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="flex items-center gap-5">
              {i % 2 === 0 ? (
                <>
                  <SquareSlot index={i} mode={mode} className="w-[42%]" />
                  <CopyBlock />
                </>
              ) : (
                <>
                  <CopyBlock />
                  <SquareSlot index={i} mode={mode} className="w-[42%]" />
                </>
              )}
            </div>
          ))}
        </div>
      </PageChrome>
    );
  }

  if (layoutId === "feature-grid") {
    const cols = n <= 3 ? 3 : n <= 4 ? 2 : 3;
    return (
      <PageChrome>
        <div className="mb-3 h-3 w-1/3 rounded-full bg-foreground/20" />
        <div className="mb-5 h-1.5 w-full rounded-full bg-foreground/[0.07]" />
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="space-y-2">
              <SquareSlot index={i} mode={mode} className="w-full" />
              <div className="h-2 w-3/4 rounded-full bg-foreground/15" />
              <div className="h-1.5 w-full rounded-full bg-foreground/[0.07]" />
            </div>
          ))}
        </div>
      </PageChrome>
    );
  }

  if (layoutId === "carousel") {
    return (
      <PageChrome>
        <div className="mb-3 h-3 w-2/5 rounded-full bg-foreground/20" />
        <div className="mb-4 h-1.5 w-full rounded-full bg-foreground/[0.07]" />
        <div className="flex gap-3 overflow-hidden pb-2">
          {Array.from({ length: n }, (_, i) => (
            <div
              key={i}
              className="w-[min(72%,260px)] shrink-0 space-y-2"
              style={{ opacity: i === 0 ? 1 : 0.85 }}
            >
              <SquareSlot index={i} mode={mode} className="w-full" />
              <div className="h-1.5 w-2/3 rounded-full bg-foreground/[0.08]" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-center gap-1.5">
          {Array.from({ length: n }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === 0
                  ? "w-4 bg-foreground/50"
                  : "w-1.5 bg-foreground/15"
              }`}
            />
          ))}
        </div>
      </PageChrome>
    );
  }

  if (layoutId === "stacked-squares") {
    return (
      <PageChrome>
        <div className="mb-4 h-3 w-1/3 rounded-full bg-foreground/20" />
        <div className="space-y-8">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="space-y-3">
              <div className="h-2.5 w-2/5 rounded-full bg-foreground/15" />
              <div className="h-1.5 w-full rounded-full bg-foreground/[0.07]" />
              <div className="mx-auto w-[58%] max-w-[280px]">
                <SquareSlot index={i} mode={mode} className="w-full" />
              </div>
              <div className="h-1.5 w-[90%] rounded-full bg-foreground/[0.07]" />
            </div>
          ))}
        </div>
      </PageChrome>
    );
  }

  if (layoutId === "spotlight") {
    return (
      <PageChrome>
        <div className="mb-3 h-3 w-1/3 rounded-full bg-foreground/20" />
        <div className="mb-4 space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-foreground/[0.07]" />
          <div className="h-1.5 w-4/5 rounded-full bg-foreground/[0.07]" />
        </div>
        <div className="mx-auto mb-6 w-[62%] max-w-[300px]">
          <SquareSlot index={0} mode={mode} className="w-full" />
        </div>
        {n >= 2 ? (
          <div className="mb-5 flex items-center gap-5">
            <SquareSlot index={1} mode={mode} className="w-[36%]" />
            <CopyBlock dense />
          </div>
        ) : null}
        {n >= 3 ? (
          <div className="flex items-center gap-5">
            <CopyBlock dense />
            <SquareSlot index={2} mode={mode} className="w-[36%]" />
          </div>
        ) : null}
      </PageChrome>
    );
  }

  // mosaic
  const gridCount = Math.max(2, n - 2);
  return (
    <PageChrome>
      <div className="mb-5 h-3 w-1/3 rounded-full bg-foreground/20" />
      <div className="mb-5 flex items-center gap-5">
        <SquareSlot index={0} mode={mode} className="w-[40%]" />
        <CopyBlock dense />
      </div>
      <div className="mb-6 flex items-center gap-5">
        <CopyBlock dense />
        <SquareSlot index={1} mode={mode} className="w-[40%]" />
      </div>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.min(gridCount, 3)}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: gridCount }, (_, i) => (
          <div key={i} className="space-y-2">
            <SquareSlot index={i + 2} mode={mode} className="w-full" />
            <div className="h-1.5 w-2/3 rounded-full bg-foreground/[0.08]" />
          </div>
        ))}
      </div>
    </PageChrome>
  );
}

/** Tiny glyph for the layout list (always structure-style). */
function LayoutGlyph({ layoutId }: { layoutId: VisualizerLayoutId }) {
  const cell = "rounded-[2px] bg-foreground/25";
  const line = "h-[2px] rounded-full bg-foreground/15";
  if (layoutId === "zigzag") {
    return (
      <div className="flex h-8 w-10 flex-col justify-center gap-1 p-0.5">
        <div className="flex gap-0.5">
          <div className={`aspect-square w-[38%] ${cell}`} />
          <div className="flex flex-1 flex-col justify-center gap-0.5">
            <div className={line} />
            <div className={`${line} w-2/3`} />
          </div>
        </div>
        <div className="flex gap-0.5">
          <div className="flex flex-1 flex-col justify-center gap-0.5">
            <div className={line} />
            <div className={`${line} w-2/3`} />
          </div>
          <div className={`aspect-square w-[38%] ${cell}`} />
        </div>
      </div>
    );
  }
  if (layoutId === "feature-grid") {
    return (
      <div className="grid h-8 w-10 grid-cols-2 gap-0.5 p-0.5">
        <div className={`aspect-square ${cell}`} />
        <div className={`aspect-square ${cell}`} />
        <div className={`aspect-square ${cell}`} />
        <div className={`aspect-square ${cell}`} />
      </div>
    );
  }
  if (layoutId === "carousel") {
    return (
      <div className="flex h-8 w-10 items-center gap-0.5 overflow-hidden p-0.5">
        <div className={`aspect-square w-[46%] ${cell}`} />
        <div className={`aspect-square w-[34%] opacity-70 ${cell}`} />
        <div className={`aspect-square w-[28%] opacity-40 ${cell}`} />
      </div>
    );
  }
  if (layoutId === "stacked-squares") {
    return (
      <div className="flex h-8 w-10 flex-col items-center justify-center gap-0.5 p-0.5">
        <div className={`aspect-square w-[48%] ${cell}`} />
        <div className={`aspect-square w-[48%] ${cell}`} />
      </div>
    );
  }
  if (layoutId === "spotlight") {
    return (
      <div className="flex h-8 w-10 flex-col items-center justify-center gap-0.5 p-0.5">
        <div className={`aspect-square w-[55%] ${cell}`} />
        <div className="flex w-full gap-0.5">
          <div className={`aspect-square w-[36%] ${cell}`} />
          <div className="flex flex-1 flex-col justify-center gap-0.5">
            <div className={line} />
            <div className={`${line} w-1/2`} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-8 w-10 flex-col justify-center gap-0.5 p-0.5">
      <div className="flex gap-0.5">
        <div className={`aspect-square w-[40%] ${cell}`} />
        <div className="flex flex-1 flex-col justify-center gap-0.5">
          <div className={line} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-0.5">
        <div className={`aspect-square ${cell}`} />
        <div className={`aspect-square ${cell}`} />
      </div>
    </div>
  );
}

export function DescriptionLayoutDialog({
  open,
  onOpenChange,
  layoutId,
  imageCount,
  disabled,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layoutId: VisualizerLayoutId;
  imageCount: number;
  disabled?: boolean;
  onApply: (next: {
    layoutId: VisualizerLayoutId;
    imageCount: number;
  }) => void;
}) {
  const [draftLayout, setDraftLayout] = useState(layoutId);
  const [draftCount, setDraftCount] = useState(
    clampVisualizerImageCount(layoutId, imageCount)
  );
  const [previewMode, setPreviewMode] = useState<PreviewMode>("structure");

  useEffect(() => {
    if (!open) return;
    setDraftLayout(layoutId);
    setDraftCount(clampVisualizerImageCount(layoutId, imageCount));
    setPreviewMode("structure");
  }, [open, layoutId, imageCount]);

  const layout = getVisualizerLayout(draftLayout);
  const clamped = clampVisualizerImageCount(draftLayout, draftCount);
  const atMin = clamped <= layout.minImages;
  const atMax = clamped >= layout.maxImages;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90vh,760px)] w-[min(96vw,1180px)] max-w-[min(96vw,1180px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1180px)]">
        <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_300px]">
          {/* LEFT — live stage */}
          <div className="relative flex min-h-0 flex-col overflow-hidden border-b border-border bg-muted/40 lg:border-r lg:border-b-0 dark:bg-muted/20">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(0,0,0,0.04),transparent_60%)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(255,255,255,0.06),transparent_55%)]" />
            <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-2">
              <div>
                <DialogHeader className="space-y-0.5 text-left">
                  <DialogTitle className="text-sm font-semibold tracking-tight">
                    {layout.name}
                  </DialogTitle>
                  <DialogDescription className="text-[11px] text-muted-foreground">
                    {layout.shortDescription} · square 1:1 only
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="flex items-center rounded-full border border-border bg-background/80 p-0.5 shadow-sm backdrop-blur">
                {(
                  [
                    ["structure", "Structure"],
                    ["filled", "With images"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreviewMode(id)}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      previewMode === id
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div
              key={`${draftLayout}-${clamped}-${previewMode}`}
              className="relative z-10 flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-4 py-4 sm:px-8 animate-in fade-in-0 zoom-in-95 duration-200"
            >
              <LiveLayoutPreview
                layoutId={draftLayout}
                imageCount={clamped}
                mode={previewMode}
              />
            </div>

            <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background/80 px-5 py-3 backdrop-blur">
              <p className="max-w-md text-[11px] leading-snug text-muted-foreground">
                {previewMode === "structure"
                  ? "Empty slots show where each square image will sit in the HTML."
                  : "Filled slots preview how product squares land once images are generated."}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Squares
                </span>
                <button
                  type="button"
                  disabled={disabled || atMin}
                  aria-label="Fewer images"
                  onClick={() => setDraftCount(clamped - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background disabled:opacity-40"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-6 text-center text-sm font-semibold tabular-nums">
                  {clamped}
                </span>
                <button
                  type="button"
                  disabled={disabled || atMax}
                  aria-label="More images"
                  onClick={() => setDraftCount(clamped + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT — layout rail */}
          <aside className="flex min-h-0 flex-col border-border bg-background dark:bg-card">
            <div className="shrink-0 border-b px-4 py-3">
              <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Layouts
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Pick a composition. Agent follows it exactly.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="flex flex-col gap-0.5">
                {VISUALIZER_LAYOUT_IDS.map((id) => {
                  const item = VISUALIZER_LAYOUTS[id];
                  const selected = draftLayout === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setDraftLayout(id);
                        setDraftCount((current) =>
                          clampVisualizerImageCount(id, current)
                        );
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-60 ${
                        selected
                          ? "bg-muted text-foreground ring-1 ring-border"
                          : "hover:bg-muted/70"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border ${
                          selected
                            ? "border-border bg-background"
                            : "border-border bg-muted/40"
                        }`}
                      >
                        <LayoutGlyph layoutId={id} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-semibold">
                            {item.name}
                          </span>
                          {selected ? (
                            <Check className="h-3 w-3 shrink-0 text-muted-foreground" />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {item.minImages}–{item.maxImages} ·{" "}
                          {item.shortDescription}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="shrink-0 space-y-3 border-t px-4 py-3">
              <p className="text-[11px] leading-snug text-muted-foreground">
                {layout.constraintHint}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="flex-1"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  disabled={disabled}
                  onClick={() => {
                    onApply({
                      layoutId: draftLayout,
                      imageCount: clampVisualizerImageCount(
                        draftLayout,
                        draftCount
                      ),
                    });
                    onOpenChange(false);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Compact sidebar control: live composition strip + meta. */
export function LayoutSettingsButton({
  layoutId,
  imageCount,
  disabled,
  onClick,
}: {
  layoutId: VisualizerLayoutId;
  imageCount: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  const layout = getVisualizerLayout(layoutId);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Layout
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {imageCount}× 1:1
        </span>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="group w-full overflow-hidden rounded-lg border bg-background text-left transition-colors hover:border-foreground/30 hover:bg-muted/30 disabled:opacity-60"
      >
        <div className="relative flex h-[72px] items-center justify-center border-b border-border bg-gradient-to-b from-muted/60 to-muted/20 px-3 dark:from-muted/40 dark:to-muted/10">
          <div className="scale-[0.92] opacity-90 transition-transform group-hover:scale-100">
            <LayoutGlyph layoutId={layoutId} />
          </div>
          <div className="pointer-events-none absolute inset-x-3 bottom-2 flex gap-1">
            {Array.from({ length: Math.min(imageCount, 6) }, (_, i) => (
              <span
                key={i}
                className="h-1 flex-1 rounded-full bg-foreground/15 dark:bg-foreground/25"
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">{layout.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {layout.shortDescription}
            </div>
          </div>
          <span className="shrink-0 text-[10px] font-medium text-muted-foreground opacity-70 group-hover:opacity-100">
            Edit
          </span>
        </div>
      </button>
    </div>
  );
}

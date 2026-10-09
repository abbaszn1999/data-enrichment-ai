"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  VISUALIZER_MAX_IMAGES,
  visualizerSlotRole,
  visualizerUserCount,
  type VisualizerLayoutId,
} from "@/lib/visualizer/layouts";
import {
  getVisualizerTheme,
  VISUALIZER_THEME_IDS,
  VISUALIZER_THEMES,
  type VisualizerImageStyle,
} from "@/lib/visualizer/themes";
import {
  isCompactSlot,
  renderVisualizerPage,
  type VisualizerPageCopy,
} from "@/lib/visualizer/templates";

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

function sampleCopy(layoutId: VisualizerLayoutId, n: number): VisualizerPageCopy {
  const base = {
    headline: "Your product headline",
    intro:
      "A short opening hook that names what the shopper wants and how this product delivers it.",
    closing: "A closing line that reinforces the value.",
  };
  if (layoutId === "showcase") {
    return {
      ...base,
      sections: [],
      showcase: {
        tagline: "Product name",
        badge: "Top feature",
        highlights: [
          { value: "10 h", label: "Key spec" },
          { value: "2", label: "Second fact" },
          { value: "Best", label: "Strongest benefit" },
        ],
        promise: "One promise, such as the warranty",
        galleryCount: n - 2,
      },
    };
  }
  return {
    ...base,
    sections: Array.from({ length: n }, (_, i) => {
      const compact = isCompactSlot(layoutId, i + 1);
      return {
        heading: `Benefit ${i + 1}`,
        body: compact
          ? "One or two sentences about the benefit this image proves."
          : "A paragraph about the benefit this image proves: the feature behind it and why it matters to the shopper.",
        bullets: compact ? [] : ["A supporting fact", "Another detail"],
      };
    }),
  };
}

/**
 * The real page template with sample copy. Empty slots, or in "With images"
 * mode the theme's sample photo (tinted stand-ins for Auto), show the images.
 */
function LiveLayoutPreview({
  layoutId,
  imageCount,
  mode,
  theme,
}: {
  layoutId: VisualizerLayoutId;
  imageCount: number;
  mode: PreviewMode;
  theme: VisualizerImageStyle;
}) {
  const html = useMemo(() => {
    const n = clampVisualizerImageCount(layoutId, imageCount);
    const sample = getVisualizerTheme(theme).sample;
    let page = renderVisualizerPage(layoutId, sampleCopy(layoutId, n), { direction: "ltr" });
    for (let index = 1; index <= n; index += 1) {
      const role = visualizerSlotRole(layoutId, n, index);
      let fill: string;
      if (mode !== "filled") {
        fill =
          "border:1px dashed rgba(127,127,127,0.45);background:rgba(127,127,127,0.08);border-radius:8px;box-sizing:border-box";
      } else if (role === "packshot") {
        fill = "background:#FFFFFF url(/visualizer/themes/studio.webp) center/cover";
      } else if (sample) {
        fill = `background:url(${sample}) center/cover`;
      } else {
        fill = `background:${FILL_TONES[(index - 1) % FILL_TONES.length]}`;
      }
      page = page.replace(`[imageplaceholder-${index}]`, `<div style="width:100%;height:100%;${fill}"></div>`);
    }
    return page;
  }, [layoutId, imageCount, mode, theme]);

  return (
    <PageChrome>
      {/* Only template output with constant sample text may be rendered here. */}
      <div className="text-[12px] text-foreground" dangerouslySetInnerHTML={{ __html: html }} />
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
  if (layoutId === "showcase") {
    return (
      <div className="flex h-8 w-10 flex-col gap-0.5 p-0.5">
        <div className="h-[3px] rounded-full bg-foreground/35" />
        <div className="flex flex-1 items-center rounded-[2px] bg-foreground/15 p-0.5">
          <div className="flex h-full w-full items-center gap-0.5 rounded-[2px] bg-background/90 p-0.5">
            <div className={`aspect-square h-full ${cell}`} />
            <div className="flex flex-1 flex-col gap-0.5">
              <div className={line} />
              <div className={`${line} w-2/3`} />
            </div>
          </div>
        </div>
        <div className="flex gap-0.5">
          <div className={`h-2 w-[30%] ${cell}`} />
          <div className={`h-2 w-[30%] ${cell}`} />
          <div className={`h-2 w-[30%] opacity-50 ${cell}`} />
        </div>
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
  theme,
  disabled,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layoutId: VisualizerLayoutId;
  imageCount: number;
  theme: VisualizerImageStyle;
  disabled?: boolean;
  onApply: (next: {
    layoutId: VisualizerLayoutId;
    imageCount: number;
    theme: VisualizerImageStyle;
  }) => void;
}) {
  const [draftLayout, setDraftLayout] = useState(layoutId);
  const [draftCount, setDraftCount] = useState(
    clampVisualizerImageCount(layoutId, imageCount)
  );
  const [draftTheme, setDraftTheme] = useState(theme);
  const [themeOpen, setThemeOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("structure");

  useEffect(() => {
    if (!open) return;
    setDraftLayout(layoutId);
    setDraftCount(clampVisualizerImageCount(layoutId, imageCount));
    setDraftTheme(theme);
    setThemeOpen(false);
    setPreviewMode("structure");
  }, [open, layoutId, imageCount, theme]);

  const activeTheme = getVisualizerTheme(draftTheme);

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
                    {layout.shortDescription} ·{" "}
                    {draftLayout === "showcase" ? "16:9 scene, 1:1 product, 4:5 gallery" : "square 1:1 only"}
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
                theme={draftTheme}
              />
            </div>

            {themeOpen ? (
              <div className="absolute inset-x-4 bottom-16 z-20 rounded-xl border border-border bg-background p-3 shadow-xl animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Image theme
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Applies to every image of every product (the product shot on white stays white)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {VISUALIZER_THEME_IDS.map((id) => {
                    const item = VISUALIZER_THEMES[id];
                    const selected = draftTheme === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setDraftTheme(id);
                          setThemeOpen(false);
                          setPreviewMode("filled");
                        }}
                        className={`overflow-hidden rounded-lg border text-left transition-colors disabled:opacity-60 ${
                          selected ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-foreground/40"
                        }`}
                      >
                        {item.sample ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.sample} alt="" className="aspect-[4/3] w-full object-cover" />
                        ) : (
                          <div className="flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-muted to-muted/40 text-[10px] font-medium text-muted-foreground">
                            Best per product
                          </div>
                        )}
                        <div className="px-2 py-1.5">
                          <div className="flex items-center gap-1 text-[11px] font-semibold">
                            {item.name}
                            {selected ? <Check className="h-3 w-3 text-muted-foreground" /> : null}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">{item.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background/80 px-5 py-3 backdrop-blur">
              <p className="max-w-md text-[11px] leading-snug text-muted-foreground">
                {previewMode === "structure"
                  ? "This is the exact page template. Empty slots show where each image will sit."
                  : "Filled slots use the theme sample to preview how the images land."}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setThemeOpen((value) => !value)}
                  aria-expanded={themeOpen}
                  className="mr-2 flex h-7 items-center gap-1.5 rounded-md border border-border bg-background pr-2.5 pl-1 text-[11px] font-medium disabled:opacity-40"
                >
                  {activeTheme.sample ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={activeTheme.sample} alt="" className="h-5 w-5 rounded object-cover" />
                  ) : (
                    <span className="h-5 w-5 rounded bg-gradient-to-br from-muted-foreground/30 to-muted-foreground/10" />
                  )}
                  <span className="text-muted-foreground">Theme</span>
                  {activeTheme.name}
                </button>
                <span className="text-[11px] text-muted-foreground">
                  {layout.countLabel ?? "Squares"}
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
                  {visualizerUserCount(draftLayout, clamped)}
                </span>
                {layout.fixedSlots ? (
                  <span className="text-[10px] text-muted-foreground">+ scene &amp; product shot</span>
                ) : null}
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
                Pick a composition. Every product uses it exactly.
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
                        const shown = visualizerUserCount(draftLayout, clampVisualizerImageCount(draftLayout, draftCount));
                        setDraftLayout(id);
                        setDraftCount(clampVisualizerImageCount(id, shown + (item.fixedSlots ?? 0)));
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
                          {visualizerUserCount(id, item.minImages)}–{visualizerUserCount(id, item.maxImages)} ·{" "}
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
                      theme: draftTheme,
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
          {layout.fixedSlots
            ? `${visualizerUserCount(layoutId, imageCount)} + ${layout.fixedSlots} images`
            : `${imageCount}× 1:1`}
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
            {Array.from({ length: Math.min(imageCount, VISUALIZER_MAX_IMAGES) }, (_, i) => (
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

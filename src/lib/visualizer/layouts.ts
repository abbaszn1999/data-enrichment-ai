export const VISUALIZER_LAYOUT_IDS = [
  "zigzag",
  "feature-grid",
  "carousel",
  "stacked-squares",
  "spotlight",
  "mosaic",
] as const;

export type VisualizerLayoutId = (typeof VISUALIZER_LAYOUT_IDS)[number];

/** Legacy layout ids from earlier sessions → current ids. */
const LEGACY_LAYOUT_MAP: Record<string, VisualizerLayoutId> = {
  "editorial-hero": "spotlight",
  "story-bands": "stacked-squares",
  "magazine-mix": "mosaic",
};

export type VisualizerLayoutDefinition = {
  id: VisualizerLayoutId;
  name: string;
  shortDescription: string;
  /** Shown when the user picks an invalid count for this layout. */
  constraintHint: string;
  minImages: number;
  maxImages: number;
  defaultImages: number;
  /** Exact structural rules the description agent must follow. */
  agentRules: (imageCount: number) => string;
};

/** Shared square-image constraint for every layout (product always generates 1:1). */
const SQUARE_IMAGE_RULES = [
  "SQUARE IMAGE CONSTRAINT (MANDATORY): every generated image is exactly 1:1 square.",
  "Every image cell MUST use square framing, e.g. style=\"aspect-ratio:1/1;width:100%;max-width:480px;overflow:hidden\" (or 100% width inside equal grid cells).",
  "Never stretch, crop instructions for landscape/portrait heroes, or ask for wide banners — keep square boxes only.",
  "Put the marker alone inside its square media cell (no extra <figure> wrappers).",
].join("\n");

export const VISUALIZER_LAYOUTS: Record<
  VisualizerLayoutId,
  VisualizerLayoutDefinition
> = {
  zigzag: {
    id: "zigzag",
    name: "Zigzag",
    shortDescription: "Alternating square + copy rows",
    constraintHint:
      "Zigzag needs at least 2 squares to create left/right rhythm.",
    minImages: 2,
    maxImages: 6,
    defaultImages: 4,
    agentRules: (n) =>
      [
        `SELECTED LAYOUT: Zigzag (STRICT — follow exactly)`,
        `Use exactly ${n} image placeholders.`,
        SQUARE_IMAGE_RULES,
        "Structure: vertical sequence of SPLIT rows that ALTERNATE direction. Each image cell is a SQUARE.",
        "Odd placeholders (1, 3, 5…): square LEFT, copy RIGHT.",
        "Even placeholders (2, 4, 6…): copy LEFT, square RIGHT.",
        "Do NOT use carousels, mosaics, or full-width stretched bands.",
        "HTML pattern for SPLIT:",
        `<section style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:center;margin:1.75rem 0"><div style="flex:0 1 280px;width:100%;max-width:320px;aspect-ratio:1/1;overflow:hidden">[imageplaceholder-N]</div><div style="flex:1 1 260px;min-width:220px"><h3>...</h3><p>...</p></div></section>`,
        "SPLIT REVERSE: swap the two inner divs (copy first, square second).",
        "Short intro header/hook before the first row.",
      ].join("\n"),
  },
  "feature-grid": {
    id: "feature-grid",
    name: "Feature Grid",
    shortDescription: "Equal square feature cards",
    constraintHint:
      "Feature Grid needs at least 3 squares so the card grid feels complete.",
    minImages: 3,
    maxImages: 6,
    defaultImages: 3,
    agentRules: (n) =>
      [
        `SELECTED LAYOUT: Feature Grid (STRICT — follow exactly)`,
        `Use exactly ${n} image placeholders.`,
        SQUARE_IMAGE_RULES,
        "After a short intro + hook, render ONE grid with ALL placeholders as equal cards.",
        "Each card: square image on top, then short h3 + 1–2 sentence benefit.",
        "HTML pattern:",
        `<section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1.25rem;margin:1.75rem 0"><div><div style="aspect-ratio:1/1;width:100%;overflow:hidden">[imageplaceholder-N]</div><h3>...</h3><p>...</p></div>…</section>`,
        "Do NOT add zigzag splits or a carousel outside this grid.",
        "Optional short closing paragraph after the grid.",
      ].join("\n"),
  },
  carousel: {
    id: "carousel",
    name: "Carousel",
    shortDescription: "Horizontal strip of square slides",
    constraintHint:
      "Carousel needs at least 3 squares so the strip feels swipeable.",
    minImages: 3,
    maxImages: 6,
    defaultImages: 4,
    agentRules: (n) =>
      [
        `SELECTED LAYOUT: Carousel (STRICT — follow exactly)`,
        `Use exactly ${n} image placeholders.`,
        SQUARE_IMAGE_RULES,
        "After a short intro header + hook paragraph, render ONE horizontal carousel strip containing ALL squares.",
        "Use CSS scroll-snap so slides feel like a gallery carousel (no JS).",
        "Each slide is a square tile; optional short caption under each square inside the slide.",
        "HTML pattern:",
        `<section style="margin:1.75rem 0"><h3>...</h3><p>...</p><div style="display:flex;gap:1rem;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:0.5rem">` +
          Array.from({ length: n }, (_, i) => {
            const idx = i + 1;
            return `<div style="flex:0 0 min(72%,280px);scroll-snap-align:start"><div style="aspect-ratio:1/1;width:100%;overflow:hidden">[imageplaceholder-${idx}]</div><p style="margin-top:0.5rem;font-size:0.9em">…</p></div>`;
          }).join("") +
          `</div></section>`,
        "Do NOT stack the same images again as zigzag or a second grid.",
        "Optional short closing statement after the carousel.",
      ].join("\n"),
  },
  "stacked-squares": {
    id: "stacked-squares",
    name: "Stacked Squares",
    shortDescription: "Centered square beats between story copy",
    constraintHint:
      "Stacked Squares need at least 2 images to create a scrolling story rhythm.",
    minImages: 2,
    maxImages: 5,
    defaultImages: 3,
    agentRules: (n) =>
      [
        `SELECTED LAYOUT: Stacked Squares (STRICT — follow exactly)`,
        `Use exactly ${n} image placeholders.`,
        SQUARE_IMAGE_RULES,
        "Vertical story: intro copy, then repeating CENTERED SQUARE images between narrative sections.",
        "Each square is max-width constrained and centered — never a stretched full-bleed landscape band.",
        "HTML pattern for each beat:",
        `<section style="margin:2rem 0"><h3>...</h3><p>...</p><div style="margin:1.25rem auto;width:100%;max-width:420px;aspect-ratio:1/1;overflow:hidden">[imageplaceholder-N]</div><p>...</p></section>`,
        "Do NOT use side-by-side splits, grids, or carousels.",
        "Never place two placeholders back-to-back with no copy between them.",
      ].join("\n"),
  },
  spotlight: {
    id: "spotlight",
    name: "Spotlight",
    shortDescription: "One hero square, then supporting squares",
    constraintHint:
      "Spotlight works best with 1–3 squares; more crowds the hero focus.",
    minImages: 1,
    maxImages: 3,
    defaultImages: 2,
    agentRules: (n) => {
      const lines = [
        `SELECTED LAYOUT: Spotlight (STRICT — follow exactly)`,
        `Use exactly ${n} image placeholders.`,
        SQUARE_IMAGE_RULES,
        "Placeholder 1 is the HERO: a large centered square after a short opening hook.",
        "HTML for hero:",
        `<section style="margin:2rem 0;text-align:center"><p style="text-align:left">...</p><div style="margin:1.25rem auto;width:100%;max-width:480px;aspect-ratio:1/1;overflow:hidden">[imageplaceholder-1]</div><p style="text-align:left">...</p></section>`,
      ];
      if (n >= 2) {
        lines.push(
          "Placeholder 2: SPLIT row — square LEFT (max-width 280px, aspect-ratio 1/1), copy RIGHT."
        );
      }
      if (n >= 3) {
        lines.push(
          "Placeholder 3: SPLIT REVERSE — copy LEFT, square RIGHT."
        );
      }
      lines.push(
        "Do NOT use a multi-card grid or carousel. Keep the hero square dominant."
      );
      return lines.join("\n");
    },
  },
  mosaic: {
    id: "mosaic",
    name: "Mosaic",
    shortDescription: "Square pair + square detail grid",
    constraintHint:
      "Mosaic needs at least 4 squares to combine a pair and a detail grid.",
    minImages: 4,
    maxImages: 6,
    defaultImages: 4,
    agentRules: (n) => {
      const gridCount = n - 2;
      return [
        `SELECTED LAYOUT: Mosaic (STRICT — follow exactly)`,
        `Use exactly ${n} image placeholders.`,
        SQUARE_IMAGE_RULES,
        "Part 1 — Opening pair of square splits:",
        "  [imageplaceholder-1] square LEFT + copy RIGHT",
        "  [imageplaceholder-2] copy LEFT + square RIGHT",
        `Part 2 — Square detail grid with the remaining ${gridCount} placeholders (3…${n}) in ONE grid:`,
        `<section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin:1.75rem 0"><div><div style="aspect-ratio:1/1;width:100%;overflow:hidden">[imageplaceholder-N]</div><h3>...</h3><p>...</p></div>…</section>`,
        "Optional short closing statement after the grid.",
        "Do NOT add a carousel or stretched banner bands.",
      ].join("\n");
    },
  },
};

export const DEFAULT_VISUALIZER_LAYOUT_ID: VisualizerLayoutId = "zigzag";

export function isVisualizerLayoutId(value: unknown): value is VisualizerLayoutId {
  return (
    typeof value === "string" &&
    (VISUALIZER_LAYOUT_IDS as readonly string[]).includes(value)
  );
}

export function normalizeVisualizerLayoutId(
  value: unknown
): VisualizerLayoutId {
  if (isVisualizerLayoutId(value)) return value;
  if (typeof value === "string" && LEGACY_LAYOUT_MAP[value]) {
    return LEGACY_LAYOUT_MAP[value]!;
  }
  return DEFAULT_VISUALIZER_LAYOUT_ID;
}

export function getVisualizerLayout(
  id: VisualizerLayoutId | string | null | undefined
): VisualizerLayoutDefinition {
  return VISUALIZER_LAYOUTS[normalizeVisualizerLayoutId(id)];
}

export function clampVisualizerImageCount(
  layoutId: VisualizerLayoutId | string | null | undefined,
  count: number
): number {
  const layout = getVisualizerLayout(layoutId);
  const n = Number.isFinite(count) ? Math.floor(count) : layout.defaultImages;
  return Math.min(layout.maxImages, Math.max(layout.minImages, n));
}

export function resolveVisualizerLayoutSettings(input: {
  layoutId?: unknown;
  imageCount?: unknown;
  maxPlaceholders?: unknown;
}): { layoutId: VisualizerLayoutId; imageCount: number } {
  const layoutId = normalizeVisualizerLayoutId(input.layoutId);
  const layout = VISUALIZER_LAYOUTS[layoutId];
  const rawCount =
    input.imageCount !== undefined && input.imageCount !== null
      ? Number(input.imageCount)
      : input.maxPlaceholders !== undefined && input.maxPlaceholders !== null
        ? Number(input.maxPlaceholders)
        : layout.defaultImages;
  return {
    layoutId,
    imageCount: clampVisualizerImageCount(layoutId, rawCount),
  };
}

/** Absolute product max across all layouts. */
export const VISUALIZER_MAX_IMAGES = 6;

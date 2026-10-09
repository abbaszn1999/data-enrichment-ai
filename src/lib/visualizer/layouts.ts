export const VISUALIZER_LAYOUT_IDS = [
  "zigzag",
  "feature-grid",
  "carousel",
  "stacked-squares",
  "spotlight",
  "mosaic",
  "showcase",
] as const;

export type VisualizerLayoutId = (typeof VISUALIZER_LAYOUT_IDS)[number];

/**
 * What one image slot shows. "feature" is a square proof shot beside its copy;
 * Showcase adds a wide background scene, a white-background packshot and
 * portrait gallery slides.
 */
export const VISUALIZER_SLOT_ROLES = ["feature", "scene", "packshot", "gallery"] as const;
export type VisualizerSlotRole = (typeof VISUALIZER_SLOT_ROLES)[number];

export function isVisualizerSlotRole(value: unknown): value is VisualizerSlotRole {
  return typeof value === "string" && (VISUALIZER_SLOT_ROLES as readonly string[]).includes(value);
}

export const VISUALIZER_SLOT_ASPECT_RATIOS: Record<VisualizerSlotRole, string> = {
  feature: "1:1",
  scene: "16:9",
  packshot: "1:1",
  gallery: "4:5",
};

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
  /**
   * How the fixed template places each slot's copy, told to the planner so it
   * writes copy that fits. The page itself is rendered by templates.ts.
   */
  copyGuide: (imageCount: number) => string;
  /** Role of every slot, slot 1 first. Layouts without it use "feature" everywhere. */
  slotRoles?: (imageCount: number) => VisualizerSlotRole[];
};

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
    copyGuide: (n) =>
      `Headline and intro, then ${n} rows. Each row is one square image beside its section copy, alternating sides. Each section has room for a full paragraph.`,
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
    copyGuide: (n) =>
      `Headline and intro, then one grid of ${n} equal cards. Each card is a square image above a short heading and a 1–2 sentence benefit, so keep every card's copy short and similar in length.`,
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
    copyGuide: (n) =>
      `Headline and intro, then one swipeable strip of ${n} square slides. Each slide carries a short heading and a 1–2 sentence caption, so keep every slide's copy short.`,
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
    copyGuide: (n) =>
      `Headline and intro, then ${n} story beats. Each beat is a heading and paragraph, then a centered square image, then its supporting points. Write the sections as one story that flows down the page.`,
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
    copyGuide: (n) =>
      n === 1
        ? "Headline and intro, then one large hero square with the section copy below it. Slot 1 is the hero and carries the strongest claim."
        : `Headline and intro, then one large hero square (slot 1, the strongest claim) with its copy below, then ${n - 1} supporting row${n - 1 === 1 ? "" : "s"} of a square beside its copy.`,
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
    copyGuide: (n) =>
      `Headline and intro, then two rows of a square beside its copy (slots 1 and 2, full paragraphs), then a detail grid of ${n - 2} small cards (slots 3 to ${n}) with a short heading and a 1–2 sentence caption each.`,
  },
  showcase: {
    id: "showcase",
    name: "Showcase",
    shortDescription: "Banner card over a scene + photo gallery",
    constraintHint:
      "Showcase uses 1 background scene + 1 product shot + 2–6 gallery photos.",
    minImages: 4,
    maxImages: 8,
    defaultImages: 5,
    copyGuide: (n) =>
      `A strip with a short tagline, then a wide background scene (slot 1) behind a white card. The card holds the product on white (slot 2) with a small badge, and the headline, intro, 2–3 highlight tiles and one promise line. Below, a swipeable gallery of ${n - 2} lifestyle photos (slots 3 to ${n}) with no copy.`,
    slotRoles: (n) => ["scene", "packshot", ...Array.from({ length: Math.max(0, n - 2) }, () => "gallery" as const)],
  },
};

export function visualizerSlotRole(layoutId: VisualizerLayoutId | string, imageCount: number, index: number): VisualizerSlotRole {
  const layout = getVisualizerLayout(layoutId);
  return layout.slotRoles?.(clampVisualizerImageCount(layout.id, imageCount))[index - 1] ?? "feature";
}

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
export const VISUALIZER_MAX_IMAGES = 8;

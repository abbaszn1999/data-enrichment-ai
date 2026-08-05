import { z } from "zod";
import {
  DEFAULT_VISUALIZER_LAYOUT_ID,
  resolveVisualizerLayoutSettings,
  VISUALIZER_LAYOUT_IDS,
} from "@/lib/visualizer/layouts";

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const VisualizerDescriptionSettingsSchema = z.object({
  tier: z.enum(["standard", "premium"]).default("standard"),
  /** Always medium — kept in schema for legacy session JSON compat. */
  thinkingLevel: z.enum(["low", "medium", "high"]).default("medium"),
  instructions: z.string().trim().max(8_000).default(""),
  layoutId: z.enum(VISUALIZER_LAYOUT_IDS).default(DEFAULT_VISUALIZER_LAYOUT_ID),
  imageCount: z.coerce.number().int().min(1).max(6).default(4),
  /** @deprecated Synced from imageCount; kept so older sessions still parse. */
  maxPlaceholders: z.coerce.number().int().min(1).max(6).default(4),
});

export const VisualizerImagesSettingsSchema = z.object({
  /** Always Nano Banana Pro — kept for legacy session JSON compat. */
  tier: z.enum(["standard", "premium"]).default("premium"),
  aspectRatio: z
    .enum([
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ])
    .default("1:1"),
  resolution: z.enum(["0.5K", "1K", "2K", "4K"]).default("1K"),
  outputFormat: z.enum(["image/jpeg", "image/png"]).default("image/jpeg"),
  style: z
    .enum(["studio", "white", "lifestyle", "editorial", "custom"])
    .default("lifestyle"),
  /** Unused in UI — always cleared on parse. */
  instructions: z.string().trim().max(4_000).default(""),
  groundWithSearch: z.boolean().default(false),
  brandingEnabled: z.boolean().default(false),
  brandGuideMode: z.enum(["image", "colors"]).default("colors"),
  brandColors: z
    .array(HexColor)
    .max(3)
    .default(["#111827", "#2563EB", "#F59E0B"]),
  logoPath: z.string().nullable().default(null),
  brandGuidePath: z.string().nullable().default(null),
  /** Removed — always null on parse (legacy sessions may still carry a path). */
  sceneReferencePath: z.string().nullable().default(null),
});

export const VisualizerBrandSettingsSchema = z.object({
  colorPrimary: HexColor.default("#111827"),
  colorSecondary: HexColor.default("#2563EB"),
  styleNotes: z.string().trim().max(2_000).default(""),
  fontsNotes: z.string().trim().max(1_000).default(""),
});

const LegacyMappingSchema = z
  .object({
    productId: z.string().nullable().optional(),
    productName: z.string().nullable().optional(),
    productImage: z.string().nullable().optional(),
    productDescription: z.string().nullable().optional(),
    productAttributes: z.string().nullable().optional(),
    productShortDescription: z.string().nullable().optional(),
  })
  .passthrough()
  .optional();

export const VisualizerProjectSettingsSchema = z.object({
  selectedColumns: z.array(z.string()).max(500).default([]),
  productImageColumn: z.string().nullable().default(null),
  columnsSelectionExplicit: z.boolean().default(false),
  description: VisualizerDescriptionSettingsSchema.default({
    tier: "standard",
    thinkingLevel: "medium",
    instructions: "",
    layoutId: DEFAULT_VISUALIZER_LAYOUT_ID,
    imageCount: 4,
    maxPlaceholders: 4,
  }),
  images: VisualizerImagesSettingsSchema.default({
    tier: "premium",
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "image/jpeg",
    style: "lifestyle",
    instructions: "",
    groundWithSearch: false,
    brandingEnabled: false,
    brandGuideMode: "colors",
    brandColors: ["#111827", "#2563EB", "#F59E0B"],
    logoPath: null,
    brandGuidePath: null,
    sceneReferencePath: null,
  }),
  brand: VisualizerBrandSettingsSchema.default({
    colorPrimary: "#111827",
    colorSecondary: "#2563EB",
    styleNotes: "",
    fontsNotes: "",
  }),
  /** @deprecated Kept only so old saved projects parse; ignored after migration. */
  mapping: LegacyMappingSchema,
  mappingExplicit: z.boolean().optional(),
});

function migrateLegacyInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const raw = { ...(input as Record<string, unknown>) };
  const mapping =
    raw.mapping && typeof raw.mapping === "object"
      ? (raw.mapping as Record<string, unknown>)
      : null;

  if (
    (raw.productImageColumn === undefined || raw.productImageColumn === null) &&
    mapping?.productImage
  ) {
    raw.productImageColumn = mapping.productImage;
  }

  if (!Array.isArray(raw.selectedColumns)) {
    raw.selectedColumns = [];
  }

  if (raw.columnsSelectionExplicit === undefined) {
    raw.columnsSelectionExplicit = Boolean(
      raw.mappingExplicit ||
        (Array.isArray(raw.selectedColumns) && raw.selectedColumns.length > 0)
    );
  }

  // Sync brand colors ↔ brand primary/secondary for description prompts.
  const images =
    raw.images && typeof raw.images === "object"
      ? { ...(raw.images as Record<string, unknown>) }
      : {};
  const brand =
    raw.brand && typeof raw.brand === "object"
      ? { ...(raw.brand as Record<string, unknown>) }
      : {};
  const description =
    raw.description && typeof raw.description === "object"
      ? { ...(raw.description as Record<string, unknown>) }
      : {};

  const brandColors = Array.isArray(images.brandColors)
    ? (images.brandColors as string[])
    : null;
  if (brandColors?.[0] && !brand.colorPrimary) {
    brand.colorPrimary = brandColors[0];
  }
  if (brandColors?.[1] && !brand.colorSecondary) {
    brand.colorSecondary = brandColors[1];
  }
  if (
    (!brandColors || brandColors.length === 0) &&
    (brand.colorPrimary || brand.colorSecondary)
  ) {
    images.brandColors = [
      String(brand.colorPrimary || "#111827"),
      String(brand.colorSecondary || "#2563EB"),
      "#F59E0B",
    ];
  }
  if (images.brandGuideMode === undefined || images.brandGuideMode === null) {
    images.brandGuideMode = images.brandGuidePath ? "image" : "colors";
  }

  // Fixed product defaults (UI no longer exposes these controls).
  description.thinkingLevel = "medium";
  const layoutResolved = resolveVisualizerLayoutSettings({
    layoutId: description.layoutId,
    imageCount: description.imageCount,
    maxPlaceholders: description.maxPlaceholders,
  });
  description.layoutId = layoutResolved.layoutId;
  description.imageCount = layoutResolved.imageCount;
  description.maxPlaceholders = layoutResolved.imageCount;

  images.tier = "premium";
  images.aspectRatio = "1:1";
  images.resolution = "1K";
  images.instructions = "";
  images.groundWithSearch = false;
  images.sceneReferencePath = null;

  raw.description = description;
  raw.images = images;
  raw.brand = brand;
  return raw;
}

export function parseVisualizerProjectSettings(input: unknown) {
  const parsed = VisualizerProjectSettingsSchema.parse(
    migrateLegacyInput(input ?? {})
  );
  const brandColors = parsed.images.brandColors;
  const layoutResolved = resolveVisualizerLayoutSettings(parsed.description);
  return {
    selectedColumns: [...parsed.selectedColumns],
    productImageColumn: parsed.productImageColumn,
    columnsSelectionExplicit: parsed.columnsSelectionExplicit,
    description: {
      ...parsed.description,
      thinkingLevel: "medium" as const,
      layoutId: layoutResolved.layoutId,
      imageCount: layoutResolved.imageCount,
      maxPlaceholders: layoutResolved.imageCount,
    },
    images: {
      ...parsed.images,
      tier: "premium" as const,
      aspectRatio: "1:1",
      resolution: "1K",
      instructions: "",
      groundWithSearch: false,
      sceneReferencePath: null,
      brandColors: [...brandColors],
    },
    brand: {
      ...parsed.brand,
      colorPrimary: brandColors[0] || parsed.brand.colorPrimary,
      colorSecondary: brandColors[1] || parsed.brand.colorSecondary,
    },
  };
}

/** Fill selectedColumns from worksheet columns when the user never chose yet. */
export function hydrateVisualizerColumns(
  settings: ReturnType<typeof parseVisualizerProjectSettings>,
  worksheetColumns: string[]
) {
  if (settings.columnsSelectionExplicit && settings.selectedColumns.length > 0) {
    return {
      ...settings,
      selectedColumns: settings.selectedColumns.filter((column) =>
        worksheetColumns.includes(column)
      ),
      productImageColumn:
        settings.productImageColumn &&
        worksheetColumns.includes(settings.productImageColumn)
          ? settings.productImageColumn
          : null,
    };
  }
  if (settings.selectedColumns.length === 0 && worksheetColumns.length > 0) {
    return {
      ...settings,
      selectedColumns: [...worksheetColumns],
      productImageColumn:
        settings.productImageColumn &&
        worksheetColumns.includes(settings.productImageColumn)
          ? settings.productImageColumn
          : null,
    };
  }
  return {
    ...settings,
    selectedColumns: settings.selectedColumns.filter((column) =>
      worksheetColumns.includes(column)
    ),
    productImageColumn:
      settings.productImageColumn &&
      worksheetColumns.includes(settings.productImageColumn)
        ? settings.productImageColumn
        : null,
  };
}

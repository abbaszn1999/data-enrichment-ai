import { z } from "zod";

export const GallerySearchDepthSchema = z.enum(["low", "medium", "high"]);

const GalleryMainSettingsSchema = z.object({
  imagesPerRow: z.coerce.number().int().min(1).max(6).default(1),
  instructions: z.string().trim().max(2_000).default(""),
});

export const GalleryScrapingSettingsSchema = z.object({
  main: GalleryMainSettingsSchema.default({
    imagesPerRow: 1,
    instructions: "",
  }),
  tier: z.enum(["standard", "premium"]).default("standard"),
  imagesPerRow: z.coerce.number().int().min(1).max(12).default(4),
  instructions: z.string().trim().max(2_000).default(""),
  searchDepth: GallerySearchDepthSchema.default("high"),
  sourcePolicy: z
    .enum(["any", "prefer-official", "official-only"])
    .default("any"),
  excludeMarketplaces: z.boolean().default(false),
  timeRange: z.string().trim().max(50).optional(),
  minResolution: z.coerce.number().int().min(0).max(5_000).default(1_200),
  aspectRatio: z
    .enum(["any", "square", "landscape", "portrait"])
    .default("any"),
  duplicates: z.literal("avoid").default("avoid"),
  matchStrictness: z.literal("strict").default("strict"),
});

export const GalleryAiSettingsSchema = z.object({
  main: GalleryMainSettingsSchema.default({
    imagesPerRow: 1,
    instructions: "",
  }),
  tier: z.enum(["standard", "premium"]).default("standard"),
  imagesPerRow: z.coerce.number().int().min(1).max(8).default(4),
  aspectRatio: z
    .enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"])
    .default("1:1"),
  resolution: z.enum(["0.5K", "1K", "2K", "4K"]).default("1K"),
  outputFormat: z.enum(["image/jpeg", "image/png"]).default("image/jpeg"),
  style: z.string().trim().max(100).default("studio"),
  instructions: z.string().trim().max(2_000).default(""),
  groundWithSearch: z.boolean().default(false),
  brandingEnabled: z.boolean().default(false),
  brandGuideMode: z.enum(["image", "colors"]).optional(),
  brandColors: z
    .array(z.string().regex(/^#[0-9a-f]{6}$/i))
    .max(3)
    .default(["#111827", "#2563EB", "#F59E0B"]),
  logoPath: z.string().nullable().default(null),
  brandGuidePath: z.string().nullable().default(null),
  sceneReferencePath: z.string().nullable().default(null),
}).superRefine((settings, context) => {
  if (settings.tier === "premium" && settings.resolution === "0.5K") {
    context.addIssue({
      code: "custom",
      path: ["resolution"],
      message: "Premium generation does not support 0.5K",
    });
  }
});

export function parseScrapingSettings(input: unknown) {
  const source =
    input && typeof input === "object"
      ? {
          ...(input as Record<string, unknown>),
          duplicates: "avoid",
          matchStrictness: "strict",
        }
      : input;
  return GalleryScrapingSettingsSchema.parse(source);
}

export function parseAiSettings(input: unknown) {
  const parsed = GalleryAiSettingsSchema.parse(input);
  const brandGuideMode =
    parsed.brandGuideMode ??
    (parsed.brandGuidePath ? ("image" as const) : ("colors" as const));
  return {
    ...parsed,
    brandGuideMode,
  };
}

export const GalleryProjectSettingsSchema = z.object({
  provider: z.enum(["scraping", "ai"]).default("scraping"),
  originalImageColumn: z.string().nullable().default(null),
  originalImageSelectionExplicit: z.boolean().default(false),
  selectedColumns: z.array(z.string()).max(500).default([]),
  scraping: GalleryScrapingSettingsSchema,
  ai: GalleryAiSettingsSchema,
});

export function parseGalleryProjectSettings(input: unknown) {
  const parsed = GalleryProjectSettingsSchema.parse(input);
  return {
    ...parsed,
    ai: parseAiSettings(parsed.ai),
  };
}

export function shouldApplySubmittedResponse(
  currentSignature: string,
  submittedSignature: string
): boolean {
  return currentSignature === submittedSignature;
}

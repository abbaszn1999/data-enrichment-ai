import type { GalleryAiSettings, GalleryRow, GalleryWorksheetJson } from "@/lib/gallery/types";

export type AiReferenceImage = {
  label: string;
  buffer: Buffer;
  contentType: string;
};

export type AiImageModel = "gemini-3.1-flash-image" | "gemini-3-pro-image";

export function normalizeMimeType(
  value: string
): "image/jpeg" | "image/png" | "image/webp" {
  if (value === "image/png" || value === "image/webp") return value;
  return "image/jpeg";
}

export function extensionForMime(value: string): string {
  if (value === "image/png") return "png";
  if (value === "image/webp") return "webp";
  return "jpg";
}

export function styleInstruction(style: string, hasSceneReference: boolean): string {
  if (hasSceneReference) {
    return [
      "Base lighting and finish may follow a commercial ecommerce look, but the scene/model reference overrides any default empty studio or pure-white background.",
      "Do not ignore the reference person or environment in favor of a plain catalog backdrop.",
    ].join(" ");
  }
  switch (style) {
    case "white":
      return "Clean ecommerce product photography on a seamless pure white background, soft grounded shadow, no decorative clutter.";
    case "lifestyle":
      return "Photorealistic lifestyle product photography in a natural, commercially useful setting.";
    case "editorial":
      return "Premium editorial campaign photography with art-directed lighting and polished composition.";
    case "custom":
      return "Follow the custom creative instructions exactly; do not add an unrelated house style.";
    default:
      return "Clean professional ecommerce studio photography with controlled softbox lighting, realistic materials, and a polished catalog finish.";
  }
}

export function sceneInstruction(hasSceneReference: boolean): string {
  if (!hasSceneReference) return "";
  return [
    "SCENE / MODEL REFERENCE IS MANDATORY — the attached reference image must visibly drive this output.",
    "If the reference shows a person: keep that same recognizable person (face, hair, body type, clothing style unless the product replaces a garment).",
    "If the product is wearable (apparel, shoes, watch, jewelry, bag on body, etc.): the person must wear/use the exact product naturally.",
    "If the product is NOT wearable (ball, rope, equipment, bottle, etc.): the same person must still appear in the frame actively holding, using, or posing with the exact product in a natural fitness/lifestyle composition inspired by the reference setting.",
    "Never output a lone product on an empty studio background when a person reference was provided.",
    "Never replace the product with the reference subject; the product from the worksheet remains the hero object.",
  ].join(" ");
}

export function brandingInstruction(params: {
  brandingEnabled: boolean;
  brandColors: string[];
  hasLogo: boolean;
  hasBrandGuide: boolean;
}): string {
  if (!params.brandingEnabled) {
    return "Branding is disabled; do not infer branding requirements from unused assets.";
  }
  const parts = [
    "BRANDING IS MANDATORY for this image.",
    `Brand palette (use these colors in commercially natural accents, props, backdrop tones, or packaging cues where appropriate): ${params.brandColors.join(", ") || "not specified"}.`,
  ];
  if (params.hasLogo) {
    parts.push(
      "A brand logo reference image is attached. Preserve its exact recognizable mark, proportions, and colors. Place it only where commercially natural (tag, packaging, subtle environmental branding). Never invent, redraw, or misspell logo text."
    );
  }
  if (params.hasBrandGuide) {
    parts.push(
      "A brand-guide / art-direction reference image is attached. Follow its visual language: typography mood, photography style, spacing, color usage, and overall brand feel. The output must look on-brand with that guide."
    );
  }
  if (!params.hasLogo && !params.hasBrandGuide) {
    parts.push(
      "No logo or brand-guide image was attached; apply the palette subtly without inventing a logo or brand text."
    );
  }
  return parts.join(" ");
}

export function buildProductDescription(
  worksheet: GalleryWorksheetJson,
  row: GalleryRow
): string {
  const columns = worksheet.selectedColumns.length
    ? worksheet.selectedColumns
    : worksheet.columns;
  return columns
    .map((column) => {
      const value = String(row.originalData[column] ?? "").trim();
      return value ? `${column}: ${value}` : "";
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 18_000);
}

export function referenceFlags(references: AiReferenceImage[]) {
  return {
    hasSceneReference: references.some((reference) =>
      /scene or model reference/i.test(reference.label)
    ),
    hasLogo: references.some((reference) =>
      /brand logo|official brand logo/i.test(reference.label)
    ),
    hasBrandGuide: references.some((reference) =>
      /brand guide|art-direction/i.test(reference.label)
    ),
    referenceList: references
      .map((reference, index) => `Reference image ${index + 1}: ${reference.label}.`)
      .join("\n"),
  };
}

/** Image output "schema" for Gemini Interactions image responses. */
export function buildAiImageResponseFormat(settings: GalleryAiSettings) {
  return {
    type: "image" as const,
    mime_type: normalizeMimeType(settings.outputFormat),
    aspect_ratio: settings.aspectRatio,
    image_size: settings.resolution,
  };
}

import { referenceMapText } from "@/lib/ai-images/reference-set";
import type { AiImageModel } from "@/lib/gallery/agents/ai-shared";
import { styleInstruction } from "@/lib/gallery/agents/ai-shared";
import type { ClassifiedRow } from "@/lib/gallery/agents/gallery-brief";
import { formatRowFields } from "@/lib/gallery/agents/planner-brief";
import { getVisualizerLayout, type VisualizerLayoutId } from "@/lib/visualizer/layouts";
import { visualizerMarker } from "@/lib/visualizer/agents/planner-plan";
import type { VisualizerImagesSettings, VisualizerBrandSettings } from "@/lib/visualizer/types";

const IMAGE_MODEL_LABELS: Record<AiImageModel, string> = {
  "gemini-3.1-flash-image": "Nano Banana 2 (fast, strong scene and product fidelity)",
  "gemini-3-pro-image": "Nano Banana Pro (studio-grade, strongest text and identity fidelity)",
};

const STYLE_LABELS: Record<string, string> = {
  studio: "Studio: controlled softbox lighting, polished catalog finish",
  white: "White background: seamless pure white, soft grounded shadow",
  lifestyle: "Lifestyle: natural, commercially useful setting",
  editorial: "Editorial: art-directed campaign look",
  custom: "Custom: follow the store owner's instructions only",
};

export interface VisualizerPlannerBriefInput {
  classified: ClassifiedRow;
  layoutId: VisualizerLayoutId;
  count: number;
  imageModel: AiImageModel;
  images: Pick<
    VisualizerImagesSettings,
    "aspectRatio" | "resolution" | "style" | "brandingEnabled" | "brandGuideMode" | "brandColors"
  >;
  brand: Pick<VisualizerBrandSettings, "styleNotes" | "fontsNotes">;
  customInstructions: string;
  /** Attached images in send order (products, brand guide, logo). */
  references: Array<{ role: string; label: string }>;
  /** Set on the retry after an unusable answer. */
  retryHint?: string;
}

/** The text part of the planner request. Pure, so the exact wording is unit-tested. */
export function buildVisualizerPlannerBrief(input: VisualizerPlannerBriefInput): string {
  const layout = getVisualizerLayout(input.layoutId);
  const count = Math.min(layout.maxImages, Math.max(layout.minImages, Math.round(input.count)));
  const { images, references } = input;
  const hasLogo = references.some((reference) => reference.role === "logo");
  const hasGuide = references.some((reference) => reference.role === "brandGuide");
  const markers = Array.from({ length: count }, (_, index) => visualizerMarker(index + 1)).join(", ");
  const sections: string[] = [];

  sections.push(
    "## Image model that will render your prompts",
    IMAGE_MODEL_LABELS[input.imageModel],
    `Output: aspect ratio ${images.aspectRatio}, ${images.resolution}. Every image on the page is a square, so write each prompt for a square frame.`
  );

  sections.push(
    "",
    "## Attached images (in this order; prompts refer to them as image 1, image 2, ...)",
    references.length === 0 ? "None attached." : referenceMapText(references)
  );

  sections.push("", "## Product data", formatRowFields(input.classified));

  sections.push(
    "",
    "## Page layout (mandatory)",
    `Layout: ${layout.name} (${layout.id}). Exactly ${count} image slot${count === 1 ? "" : "s"}.`,
    `Markers to use verbatim, each exactly once: ${markers}`,
    layout.agentRules(count)
  );

  sections.push(
    "",
    "## Image slots",
    `Plan exactly ${count} distinct image${count === 1 ? "" : "s"}, indexes 1 to ${count}. Slot N is rendered into [imageplaceholder-N]. The copy next to a marker must be about the same claim that slot's image proves, and each image must show something the others do not.`
  );

  const custom = input.customInstructions.trim();
  sections.push(
    "",
    "## Custom instructions (store owner, highest priority)",
    custom || "None. Choose the story and the shot list yourself from the product data and images."
  );

  sections.push("", "## Look", STYLE_LABELS[images.style] ?? STYLE_LABELS.lifestyle, styleInstruction(images.style, false));

  const design: string[] = [];
  if (input.brand.styleNotes.trim()) design.push(`Style notes: ${input.brand.styleNotes.trim()}`);
  if (input.brand.fontsNotes.trim()) design.push(`Typography / art-direction notes (mood only): ${input.brand.fontsNotes.trim()}`);
  if (design.length > 0) sections.push("", "## Brand design notes", design.join("\n"));

  const branding: string[] = [];
  if (!images.brandingEnabled) {
    branding.push("Branding is off. Do not add a logo or brand colours to the copy or the image prompts.");
  } else {
    branding.push("Branding is on.");
    if (images.brandGuideMode === "colors" && images.brandColors.length > 0) {
      branding.push(`Brand palette: ${images.brandColors.join(", ")}. Use it in accents, props and backdrops of the image prompts and as accent colours in the page HTML.`);
    }
    if (hasGuide) {
      branding.push("A brand guide image is attached: follow its mood, colour and photography style.");
    }
    branding.push(
      hasLogo
        ? "A logo image is attached. Set useLogo true only on shots where the logo would naturally appear (packaging, a tag, a sign, a print); keep it off shots where it would look forced."
        : "No logo image is attached. Set useLogo false on every shot and never describe a logo."
    );
  }
  sections.push("", "## Branding", branding.join("\n"));

  if (input.retryHint?.trim()) {
    sections.push(
      "",
      "## Fix your previous answer",
      `Your previous answer was rejected: ${input.retryHint.trim()} Return a corrected answer.`
    );
  }

  return sections.join("\n");
}

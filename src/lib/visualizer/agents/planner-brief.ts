import { referenceMapText } from "@/lib/ai-images/reference-set";
import type { AiImageModel } from "@/lib/gallery/agents/ai-shared";
import type { ClassifiedRow } from "@/lib/gallery/agents/gallery-brief";
import { formatRowFields } from "@/lib/gallery/agents/planner-brief";
import {
  getVisualizerLayout,
  VISUALIZER_SLOT_ASPECT_RATIOS,
  visualizerSlotRole,
  type VisualizerLayoutId,
  type VisualizerSlotRole,
} from "@/lib/visualizer/layouts";
import { isCompactSlot, VISUALIZER_COPY_LIMITS } from "@/lib/visualizer/templates";
import { getVisualizerTheme } from "@/lib/visualizer/themes";
import type { VisualizerImagesSettings, VisualizerBrandSettings } from "@/lib/visualizer/types";

const IMAGE_MODEL_LABELS: Record<AiImageModel, string> = {
  "gemini-3.1-flash-image": "Nano Banana 2 (fast, strong scene and product fidelity)",
  "gemini-3-pro-image": "Nano Banana Pro (studio-grade, strongest text and identity fidelity)",
};

const ROLE_BRIEFS: Record<VisualizerSlotRole, string> = {
  feature: "square proof shot of the product beside its copy",
  scene:
    "wide background scene inspired by the product and where it is used. The product must not appear and no image is attached to this slot, so never refer to image numbers in its prompt. No people in focus, no text. Keep the centre calm and low in detail: a white card covers it",
  packshot:
    "the exact product alone on a seamless pure white background, centred and filling about 75% of the frame, soft contact shadow, no props and no scene. The theme does not apply to this slot",
  gallery: "portrait lifestyle photo of the product in use; each gallery slide shows a different scene and angle",
};

/** One line per slot (consecutive slots of the same role share a line). */
function slotRoleLines(layoutId: VisualizerLayoutId, count: number): string[] {
  const lines: string[] = [];
  let start = 1;
  for (let index = 1; index <= count; index += 1) {
    const role = visualizerSlotRole(layoutId, count, index);
    if (index < count && visualizerSlotRole(layoutId, count, index + 1) === role) continue;
    const range = start === index ? `Slot ${index}` : `Slots ${start}–${index}`;
    lines.push(`- ${range} (${role}, ${VISUALIZER_SLOT_ASPECT_RATIOS[role]}): ${ROLE_BRIEFS[role]}.`);
    start = index + 1;
  }
  return lines;
}

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
  const limits = VISUALIZER_COPY_LIMITS;
  const compactSlots = Array.from({ length: count }, (_, index) => index + 1).filter((index) =>
    isCompactSlot(layout.id, index)
  );
  const sections: string[] = [];

  const showcase = layout.id === "showcase";
  sections.push(
    "## Image model that will render your prompts",
    IMAGE_MODEL_LABELS[input.imageModel],
    showcase
      ? `Output: ${images.resolution}. Each slot has its own frame (see Image slots); write each prompt for that frame.`
      : `Output: aspect ratio 1:1, ${images.resolution}. Every image on the page is a square, so write each prompt for a square frame.`
  );

  sections.push(
    "",
    "## Attached images (in this order; prompts refer to them as image 1, image 2, ...)",
    references.length === 0 ? "None attached." : referenceMapText(references)
  );

  sections.push("", "## Product data", formatRowFields(input.classified));

  const bodyLimits =
    compactSlots.length === 0
      ? `body up to ${limits.body} characters`
      : compactSlots.length === count
        ? `body up to ${limits.compactBody} characters`
        : `body up to ${limits.body} characters, except slots ${compactSlots.join(", ")} (small cards): up to ${limits.compactBody} characters`;
  sections.push(
    "",
    "## Page layout (fixed template)",
    `Layout: ${layout.name} (${layout.id}). Exactly ${count} image slot${count === 1 ? "" : "s"}.`,
    "The system builds the page from a fixed template; you write the text only. Every field is plain text: no HTML, no markdown, no image markers.",
    layout.copyGuide(count),
    showcase
      ? `Lengths: headline up to ${limits.headline} characters; intro up to ${limits.showcaseIntro} (it shows as two lines only, so one or two short sentences); closing up to ${limits.closing} or empty; tagline up to ${limits.tagline}; badge up to ${limits.badge}; ${limits.highlightsMin} to ${limits.highlightsMax} highlights with a value up to ${limits.highlightValue} and a label up to ${limits.highlightLabel}; promise up to ${limits.promise}.`
      : `Lengths: headline up to ${limits.headline} characters; intro up to ${limits.intro}; closing up to ${limits.closing} or empty; each slot heading up to ${limits.heading}; ${bodyLimits}; 0 to ${limits.bullets} bullets of up to ${limits.bullet} characters each.`
  );
  if (showcase) {
    sections.push(
      "Highlights and the badge use only facts from the product data or photos. A number appears only when the data states it; otherwise use one strong word (Waterproof, Foldable). Never write a price, discount or stock claim.",
      images.brandingEnabled && images.brandGuideMode === "colors" && images.brandColors.length > 0
        ? "Page colours come from the brand palette; still fill `palette` from the product."
        : "Page colours: fill `palette` from the product photos, so the strip, tiles and labels match this product (for an olive and cream play kitchen: a deep olive and a warm cream or a complementary coral; never a default yellow and green)."
    );
  }

  sections.push(
    "",
    "## Image slots",
    showcase
      ? `Plan exactly ${count} distinct images, indexes 1 to ${count}. No slot has copy beside it.`
      : `Plan exactly ${count} distinct image${count === 1 ? "" : "s"}, indexes 1 to ${count}. Each slot's heading, body and bullets sit beside that slot's image, so they must be about the same claim the image proves, and each image must show something the others do not.`,
    ...slotRoleLines(layout.id, count),
    "Shot list: the product shots read as one story told from different moments, never the same set-up twice. Each product slot has its own `setting` (place, surface and backdrop colour), its own camera angle and height, and the set mixes camera distances (wide, medium, close, macro). Change the props, the backdrop colour and, where it fits, the time of day between slots; keep only the colour grade and the level of finish shared.",
    "Identity: fill `identityLock` from the product photos and set each slot's `viewImage`. Lock the identity, not the pose: vary the camera angle (front, three-quarter, profile, high, low) and, for products with movable parts, the pose across slots, and spread `viewImage` over the product photos instead of always image 1. No slot, the packshot included, copies the angle and pose of a product photo. Avoid only sides no photo shows; the system sends `identityLock` first with every image of the product."
  );

  const custom = input.customInstructions.trim();
  sections.push(
    "",
    "## Custom instructions (store owner, highest priority)",
    custom || "None. Choose the story and the shot list yourself from the product data and images."
  );

  const theme = getVisualizerTheme(images.style);
  sections.push(
    "",
    "## Look (theme)",
    theme.recipe
      ? `Theme - ${theme.recipe} The theme is the world of the shoot, not one location: keep its light quality, mood and colour grade in every slot, and give each slot a different place inside that world.`
      : theme.id === "custom"
        ? "Follow the custom instructions for the look; do not add an unrelated house style."
        : "Auto: choose the one look that suits this product best (lifestyle, studio, outdoor, …). Keep its light quality, mood and colour grade in every slot, and give each slot a different place inside that look."
  );

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
      branding.push(`Brand palette: ${images.brandColors.join(", ")}. Use it as accents in props and styling details, and as the backdrop in at most one slot, so the set does not look like one set-up. The page applies the palette itself.`);
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

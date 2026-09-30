import type { AiImageModel } from "@/lib/gallery/agents/ai-shared";
import { styleInstruction } from "@/lib/gallery/agents/ai-shared";
import type { ClassifiedRow } from "@/lib/gallery/agents/gallery-brief";
import { referenceMapText } from "@/lib/ai-images/reference-set";
import type { GalleryAiSettings } from "@/lib/gallery/types";

const MAX_FIELD_CHARS = 1_200;
const MAX_ROW_CHARS = 14_000;

const IMAGE_MODEL_LABELS: Record<AiImageModel, string> = {
  "gemini-3.1-flash-image": "Nano Banana 2 (fast, up to 512 / 1K / 2K / 4K output)",
  "gemini-3-pro-image": "Nano Banana Pro (studio-grade, 1K / 2K / 4K output, strongest text and identity fidelity)",
};

const STYLE_LABELS: Record<string, string> = {
  studio: "Studio: controlled softbox lighting, polished catalog finish",
  white: "White background: seamless pure white, soft grounded shadow",
  lifestyle: "Lifestyle: natural, commercially useful setting",
  editorial: "Editorial: art-directed campaign look",
  custom: "Custom: follow the store owner's instructions only",
};

export interface PlannerBriefInput {
  classified: ClassifiedRow;
  count: number;
  settings: Pick<
    GalleryAiSettings,
    | "aspectRatio"
    | "resolution"
    | "style"
    | "instructions"
    | "brandingEnabled"
    | "brandGuideMode"
    | "brandColors"
  >;
  imageModel: AiImageModel;
  /** Attached images in send order (products, model, brand guide, logo). */
  references: Array<{ role: string; label: string }>;
}

function displayKey(column: string): string {
  return column.replace(/[_\s]+/g, " ").trim() || column;
}

/** Row data as `- Column: value` lines, capped so a huge sheet cell never floods the prompt. */
export function formatRowFields(classified: ClassifiedRow): string {
  if (classified.fields.length === 0) {
    return "- No usable product data was provided; rely on the attached product images.";
  }
  const lines: string[] = [];
  let total = 0;
  for (const field of classified.fields) {
    const value = field.value.length > MAX_FIELD_CHARS ? `${field.value.slice(0, MAX_FIELD_CHARS)}...` : field.value;
    const line = `- ${displayKey(field.column)}: ${value}`;
    if (total + line.length > MAX_ROW_CHARS) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

/** The text part of the planner request. Pure, so the exact wording is unit-tested. */
export function buildPlannerBrief(input: PlannerBriefInput): string {
  const { settings, references } = input;
  const count = Math.min(8, Math.max(1, Math.round(input.count)));
  const hasModel = references.some((reference) => reference.role === "model");
  const hasLogo = references.some((reference) => reference.role === "logo");
  const hasGuide = references.some((reference) => reference.role === "brandGuide");
  const sections: string[] = [];

  sections.push(
    "## Image model that will render your prompts",
    IMAGE_MODEL_LABELS[input.imageModel],
    `Output: aspect ratio ${settings.aspectRatio}, ${settings.resolution}. Write every prompt for this frame.`
  );

  sections.push(
    "",
    "## Attached images (in this order; prompts refer to them as image 1, image 2, ...)",
    references.length === 0 ? "None attached." : referenceMapText(references)
  );

  sections.push("", "## Product data", formatRowFields(input.classified));

  sections.push(
    "",
    "## Number of gallery images",
    `Plan exactly ${count} distinct image${count === 1 ? "" : "s"}, indexes 1 to ${count}. Each must show something the others do not.`
  );

  const custom = settings.instructions.trim();
  sections.push(
    "",
    "## Custom instructions (store owner, highest priority)",
    custom || "None. Choose the shot list yourself from the product data and images."
  );

  sections.push(
    "",
    "## Look",
    STYLE_LABELS[settings.style] ?? STYLE_LABELS.studio,
    styleInstruction(settings.style, hasModel)
  );

  sections.push(
    "",
    "## Model / scene reference",
    hasModel
      ? "A model or scene reference is attached. Every image must include that same person or setting with the product. If the item is worn (clothing, shoes, jewelry, watches, bags, eyewear), the person wears it; write a different outfit styling, pose and setting per image when the store owner asks for variety. If it is not worn, the person holds, uses or stands with it."
      : "None attached. Do not invent a specific named person; a generic model is allowed only when the item is worn and the instructions ask for one."
  );

  const brandingLines: string[] = [];
  if (!settings.brandingEnabled) {
    brandingLines.push("Branding is off. Do not add a logo or brand colours.");
  } else {
    brandingLines.push("Branding is on.");
    if (settings.brandGuideMode === "colors" && settings.brandColors.length > 0) {
      brandingLines.push(`Brand palette: ${settings.brandColors.join(", ")}. Use it in accents, props and backdrops.`);
    }
    if (hasGuide) {
      brandingLines.push("A brand guide image is attached: follow its mood, colour and photography style.");
    }
    brandingLines.push(
      hasLogo
        ? "A logo image is attached. Set useLogo true only on shots where the logo would naturally appear (packaging, a tag, a sign, a print); keep it off shots where it would look forced."
        : "No logo image is attached. Set useLogo false on every shot and never describe a logo."
    );
  }
  sections.push("", "## Branding", brandingLines.join("\n"));

  return sections.join("\n");
}

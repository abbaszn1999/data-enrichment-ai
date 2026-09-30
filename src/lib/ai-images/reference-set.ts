import type { AiReferenceImage, AiReferenceRole } from "@/lib/gallery/agents/ai-shared";

/**
 * Reference images are always ordered products, model, brand guide, logo. The
 * planner sees this exact order and writes "image 1", "image 2" against it; the
 * logo is last so leaving it out of a shot never renumbers the others.
 */
export const MAX_PRODUCT_REFERENCES = 4;

const ROLE_ORDER: AiReferenceRole[] = ["product", "model", "brandGuide", "logo"];

export function describeReference(role: AiReferenceRole, indexInRole: number): string {
  switch (role) {
    case "product":
      return indexInRole === 0
        ? "product photo, the trusted Main image of the exact item"
        : `additional product photo ${indexInRole + 1} of the same exact item`;
    case "model":
      return "model / scene reference: this person or setting must appear in the image";
    case "brandGuide":
      return "brand guide: visual language and mood to follow";
    case "logo":
      return "brand logo: keep its exact mark";
  }
}

/** Sort into the canonical order and cap products. Labels are rebuilt from roles. */
export function orderReferences(references: AiReferenceImage[]): AiReferenceImage[] {
  const out: AiReferenceImage[] = [];
  for (const role of ROLE_ORDER) {
    const group = references.filter((reference) => reference.role === role);
    const limited = role === "product" ? group.slice(0, MAX_PRODUCT_REFERENCES) : group.slice(0, 1);
    limited.forEach((reference, index) => {
      out.push({ ...reference, label: describeReference(role, index) });
    });
  }
  return out;
}

/** References for one shot: everything except the logo unless the plan asks for it. */
export function selectShotReferences(
  ordered: AiReferenceImage[],
  shot: { useLogo: boolean }
): AiReferenceImage[] {
  return ordered.filter((reference) => reference.role !== "logo" || shot.useLogo);
}

export function referenceMapText(references: Array<{ label: string }>): string {
  return references.map((reference, index) => `Image ${index + 1}: ${reference.label}.`).join("\n");
}

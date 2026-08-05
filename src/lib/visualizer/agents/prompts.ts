import type { VisualizerBrandSettings } from "@/lib/visualizer/types";
import {
  getVisualizerLayout,
  type VisualizerLayoutId,
  VISUALIZER_MAX_IMAGES,
} from "@/lib/visualizer/layouts";

export const DEFAULT_DESCRIPTION_SYSTEM_PROMPT = [
  "You are an elite e-commerce content strategist and visual merchandising art director.",
  "Create conversion-optimized product descriptions in semantic HTML with professional magazine-like layouts:",
  "alternate image-left / image-right splits, and choose composition based on how many images are requested.",
  "Never default to stacking every image under a paragraph.",
  "Prefer grounded observations from the product image and provided data over invented claims.",
].join(" ");

function buildVisualDesignSpecs(
  brand: VisualizerBrandSettings,
  options?: { includeManualColors?: boolean }
): string {
  const includeManualColors = options?.includeManualColors !== false;
  return [
    includeManualColors
      ? `- Brand primary color: ${brand.colorPrimary}`
      : "",
    includeManualColors
      ? `- Brand secondary / accent color: ${brand.colorSecondary}`
      : "",
    !includeManualColors
      ? "- Color direction: follow the attached brand-guide image palette and mood (do not invent a conflicting hex palette)"
      : "",
    brand.styleNotes
      ? `- Style notes: ${brand.styleNotes}`
      : "- Style notes: modern clean premium ecommerce photography",
    brand.fontsNotes
      ? `- Typography / art-direction notes (mood only): ${brand.fontsNotes}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function placeholderList(maxPlaceholders: number): string {
  return Array.from(
    { length: maxPlaceholders },
    (_, index) => `[imageplaceholder-${index + 1}]`
  ).join(", ");
}

/** Brand palette text — only when branding is enabled (no image required). */
export function buildDescriptionBrandColorsBlock(brandColors: string[]): string {
  const primary = brandColors[0] || "#111827";
  const secondary = brandColors[1] || "#2563EB";
  const accent = brandColors[2] || "#F59E0B";
  return [
    "===============================================================",
    "BRAND COLOR PALETTE (MANDATORY — branding enabled)",
    "===============================================================",
    "When writing EACH visualBrief, weave these hex colors into lighting, backdrop tones, props, packaging cues, or environmental accents where commercially natural:",
    `- Primary: ${primary}`,
    `- Secondary: ${secondary}`,
    `- Accent: ${accent}`,
    "Do not force branding where it breaks realism; prefer subtle on-brand accents over heavy overlays.",
    "Do NOT invent a logo or brand wordmark unless a logo image is attached in a following content part.",
  ].join("\n");
}

/** Logo directive — send ONLY together with an attached logo image. */
export function buildDescriptionLogoBlock(): string {
  return [
    "===============================================================",
    "BRAND LOGO REFERENCE (MANDATORY — image attached immediately after this text)",
    "===============================================================",
    "The next content part is the official brand LOGO image. Study it carefully.",
    "In EVERY visualBrief, specify a professional, commercially natural logo placement (tag, packaging, subtle environmental mark).",
    "Preserve the exact recognizable mark, proportions, and colors from this attached logo.",
    "Never invent, redraw, distort, or misspell logo text. The same logo image will also be given to the image generation model.",
  ].join("\n");
}

/** Brand-guide directive — send ONLY together with an attached guide image. */
export function buildDescriptionBrandGuideBlock(): string {
  return [
    "===============================================================",
    "BRAND GUIDE / ART-DIRECTION REFERENCE (MANDATORY — image attached immediately after this text)",
    "===============================================================",
    "The next content part is the brand guide / art-direction reference image. Study its palette, mood, photography style, and overall brand feel.",
    "Instruct EACH visualBrief to follow this guide so the eventual generated images look on-brand.",
    "The same brand-guide image will also be given to the image generation model.",
  ].join("\n");
}

export function buildDescriptionProductImageIntro(): string {
  return [
    "===============================================================",
    "PRODUCT IMAGE REFERENCE (analyze the image attached immediately after this text)",
    "===============================================================",
    "The next content part is the canonical product photo. Use it for Phase 1 visual analysis and for accurate product identity in every visualBrief.",
  ].join("\n");
}

export function buildDescriptionJsonClosing(): string {
  return [
    "Respond with JSON only matching the schema:",
    "- description: the full semantic HTML body including the [imageplaceholder-N] markers",
    "- imagePlaceholders: array of { index, visualBrief, alt } for each marker used",
    "- notes: short internal notes about assumptions or missing data (empty string if none)",
  ].join("\n");
}

/**
 * Full Phase-1 brief body (no branding image sections — those are interleaved separately).
 */
export function buildDescriptionUserPrompt(params: {
  product: Record<string, string>;
  layoutId: VisualizerLayoutId;
  imageCount: number;
  brand: VisualizerBrandSettings;
  customInstructions?: string;
  /** When false, omit manual hex palette lines (Upload image brand-guide mode). */
  includeManualBrandColors?: boolean;
}): string {
  const layout = getVisualizerLayout(params.layoutId);
  const imageCount = Math.min(
    layout.maxImages,
    Math.max(layout.minImages, Math.floor(params.imageCount) || layout.defaultImages)
  );
  const includeManualBrandColors = params.includeManualBrandColors !== false;
  const visualDesignSpecs = buildVisualDesignSpecs(params.brand, {
    includeManualColors: includeManualBrandColors,
  });
  const colorApplicationRules = includeManualBrandColors
    ? [
        visualDesignSpecs,
        "   - Use the brand primary color strategically: deep background tone, surface color, or dominant mood color",
        "   - Use the brand secondary/accent color for: light streaks, accent glows, subtle rim lighting, environmental highlights",
        "   - Ensure colors serve the scene (do not force them where they break realism — use them in lighting, background, reflections, props)",
      ].join("\n")
    : [
        visualDesignSpecs,
        "   - Derive palette and mood from the attached brand-guide image, not from invented hex codes",
        "   - Ensure colors serve the scene and stay commercially natural",
      ].join("\n");
  const custom = params.customInstructions?.trim() || "";
  const markers = placeholderList(imageCount);
  const layoutRules = layout.agentRules(imageCount);

  return `
You are an elite e-commerce content strategist and visual merchandising expert. Your mission is to create conversion-optimized product descriptions in semantic HTML with strategically placed AI-generated image opportunities.

===============================================================
PHASE 1: VISUAL PRODUCT ANALYSIS
===============================================================

CRITICAL: Analyze the attached product image thoroughly before writing. If an image is attached, extract:

PHYSICAL ATTRIBUTES:
- Colors: Primary, secondary, accent colors with specific tones (e.g., "deep burgundy with warm undertones")
- Materials: Visible textures, finishes, surfaces (e.g., "brushed aluminum", "matte leather", "woven cotton")
- Construction: Build quality indicators, stitching, joints, hardware details
- Dimensions: Relative size, proportions, thickness, depth

DESIGN ELEMENTS:
- Shape & Silhouette: Overall form, lines, curves, geometric features
- Patterns & Textures: Surface patterns, embossing, prints, weaves
- Branding: Logos, labels, distinctive marks, signature elements
- Unique Features: Standout details that differentiate this product

QUALITY SIGNALS:
- Craftsmanship indicators visible in the image
- Premium vs standard quality markers
- Attention to detail evidence

Store these observations — you will use them in BOTH the description AND image prompts.
If no image is attached, rely only on the product data and clearly avoid inventing visual details you cannot verify.

===============================================================
PHASE 2: PRODUCT INTELLIGENCE SYNTHESIS
===============================================================

Combine visual analysis with provided product data:

- Product Name: Extract brand, model, variant, collection information
- Description: Identify key selling points, technical specifications, use cases
- Attributes: Parse features, materials, sizes, compatibility information
- Short Description: Capture the core value proposition

Identify:
- PRIMARY SELLING POINTS: Top 3-5 features that drive purchase decisions
- TARGET AUDIENCE: Who buys this product and why
- USE CASES: Primary and secondary applications
- COMPETITIVE ADVANTAGES: What makes this product stand out

Hard truth rule: do not invent certifications, materials, or claims unsupported by the image or product data.

===============================================================
PHASE 3: SEO-OPTIMIZED HTML GENERATION
===============================================================

OUTPUT REQUIREMENTS:
- Generate ONLY HTML content body (NO <html>, <head>, <body>, <DOCTYPE> tags)
- Use semantic HTML5: <article>, <section>, <header>, <h1>-<h3>, <p>, <ul>, <li>, <figure>, <div>, <strong>, <blockquote>
- Do not use markdown, <script>, or inline event handlers
- Inline styles ARE allowed and REQUIRED for layout containers (flex/grid) so the HTML looks professional in any preview without external CSS
- Do not invent a full design system; use clean ecommerce layout styles only

STRUCTURE FRAMEWORK:
1. <header> with <h2>: the first heading of the description — attractive and engaging
2. Opening hook section — address customer pain point or desire
3. Feature / detail / lifestyle sections that follow the SELECTED LAYOUT below EXACTLY
4. Optional <blockquote>: impactful closing statement or call-to-action

SEO BEST PRACTICES:
- Integrate primary keyword naturally in H2, first paragraph, and throughout
- Use semantic heading hierarchy (H2 -> H3)
- Write scannable content with clear sections
- Include feature-benefit pairings (not just features)
- Optimal length: 400-600 words for product descriptions

CONVERSION OPTIMIZATION:
- Lead with benefits, support with features
- Use sensory language that helps customers visualize ownership
- Address objections proactively
- End with clear value reinforcement

===============================================================
PHASE 4: SELECTED LAYOUT — MANDATORY (DO NOT IMPROVISE)
===============================================================

The user selected a fixed page layout. You MUST follow it exactly. Do not invent a different composition.

Layout name: ${layout.name}
Layout id: ${layout.id}
Image count required: exactly ${imageCount}
Markers to use verbatim (all of them, each exactly once): ${markers}

${layoutRules}

SHARED HARD RULES FOR EVERY LAYOUT:
- Create exactly ${imageCount} placeholders — never more, never fewer
- Each placeholder must serve a distinct visual purpose
- Put each marker alone inside its media column/cell (do not wrap markers in extra <figure> tags; the system embeds images later)
- Surrounding copy must stay tightly related to that image's story
- Prefer balanced columns (image ~40–50%, text ~50–60%) in split layouts
- Never dump all images at the bottom
- Never place orphan images with no related nearby text
- Forbidden anti-pattern unless the selected layout explicitly requires stacked bands: repeating only <p>…</p>[imageplaceholder-N]<p>…</p> for every image in a zigzag or magazine layout

PLACEMENT LOGIC (what each image should show — adapt to the product):
1. FEATURE HIGHLIGHT: Close-up of a key selling point next to the benefit copy
2. LIFESTYLE/CONTEXT: Product in use or styled setting
3. DETAIL/CRAFT: Material, hardware, or construction close-up
4. Extra slots only when they clearly advance the story

===============================================================
PHASE 5: PROFESSIONAL E-COMMERCE VISUAL PROMPT ENGINEERING
===============================================================

You are now a SENIOR E-COMMERCE GRAPHIC DESIGNER AND ART DIRECTOR creating premium commercial photography briefs. Each image prompt must demonstrate deep understanding of the product, its features, and the context where the placeholder appears in the description.

Put each brief in imagePlaceholders[].visualBrief (matching index). Write alt text that is concise and useful for accessibility.

-----------------------------------------------------------
CRITICAL RULE: CONTEXT-DRIVEN VISUAL STORYTELLING
-----------------------------------------------------------

READ THE SURROUNDING TEXT of each placeholder carefully. The image MUST visually demonstrate what the text is describing. This is the #1 priority.

FEATURE-TO-VISUAL CONCEPT MAPPING (examples — apply this thinking pattern to ANY feature):
- "waterproof" / "water-resistant" → Product with crystal-clear water, visible droplets beading off surface, splash dynamics
- "lightweight" / "ultra-light" → Product floating/levitating with soft shadow beneath, feather or cloud elements, anti-gravity feel
- "durable" / "rugged" / "tough" → Rough concrete/stone surface, industrial environment, harsh directional lighting
- "breathable" / "ventilation" → Air-flow visualization, mesh detail with light passing through, fabric movement
- "grip" / "traction" / "outsole" → Low-angle shot emphasizing tread on wet/textured surface
- "comfort" / "cushioning" / "soft" → Cloud-like surface, plush fabrics, warm soft lighting
- "speed" / "performance" / "fast" → Motion blur streaks, dynamic angle, trailing light, frozen-motion capture
- "premium" / "luxury" / "elegant" → Marble/granite surface, chiaroscuro lighting, rich deep background
- "eco-friendly" / "sustainable" → Natural setting with plants/leaves, earth tones, natural sunlight
- "precision" / "engineered" → Geometric lighting, technical grid feel, sharp macro focus
- "versatile" / "multi-use" → Split-scene / multiple contexts, day-to-night transition
- "thermal" / "insulated" / "warm" → Frost/ice contrast, condensation, cold-environment protection cues
- "slim" / "compact" / "portable" → Scale comparison, pocket/bag context, negative space, minimalist composition

ALWAYS think: "What visual scene would PROVE this feature to a customer scrolling the page?"

-----------------------------------------------------------
PROMPT CONSTRUCTION FRAMEWORK
-----------------------------------------------------------

Each visualBrief must be a SINGLE FLOWING VISUAL BRIEF (not sectioned / not bulleted) that reads like a commercial photography brief. Weave ALL of the following naturally together:

1. PRODUCT IDENTITY (the image model has NO other context — describe the product fully):
   - Full product name, brand, exact colors from your Phase 1 visual analysis
   - Specific materials and textures you observed
   - Key design elements that make this product recognizable

2. SCENE CONCEPT (creative vision driven by placeholder context):
   - What visual story are you telling? What feature are you proving?
   - Dynamic scene that demonstrates the feature in the surrounding text
   - Environmental context that reinforces the value proposition

3. CAMERA & COMPOSITION:
   - Exact camera angle (e.g., "low angle 15-degree perspective", "overhead flat-lay", "eye-level macro")
   - Focal point and depth of field
   - Framing and negative space decisions

4. LIGHTING DIRECTION:
   - Cinematic lighting style
   - Light interaction with product materials
   - Shadow quality and mood

5. STRATEGIC COLOR APPLICATION:
${colorApplicationRules}

6. QUALITY MARKERS (always include):
   - "Ultra-realistic detail, 8K resolution"
   - "Premium commercial product photography"
   - An appropriate mood descriptor (e.g. "Dramatic shadow depth")
   - "Professional e-commerce campaign style"

-----------------------------------------------------------
PROMPT STYLE REFERENCE
-----------------------------------------------------------

Write prompts in this style — notice the flow, specificity, and commercial quality:

EXAMPLE (for a sneaker's grip feature section):
"Dynamic commercial footwear visual of [Brand] [Model] sneaker highlighting the trail-inspired lug outsole. Low angle perspective showing outsole grip pattern engaging with wet stone surface. Background deep black (#050608). Subtle motion light streaks in warm orange (#f06e3c) behind the shoe to imply rugged performance. Ground surface minimal matte charcoal. Cinematic directional lighting from rear creating dramatic rim light on rubber heel wrap. Sharp focus on lug texture and tread depth. High contrast performance aesthetic. Premium sports campaign style. Ultra realistic detail, 8K resolution, dramatic shadow depth."

EXAMPLE (for a waterproof feature section):
"[Brand] [Model] boot captured mid-splash in crystal clear water pool. Product partially submerged showing water beading and rolling off the treated leather upper. Underwater refraction visible below waterline. Background gradient from deep navy (#1a1a2e) to black. Accent lighting in electric blue (#4fc3f7) reflecting off water surface ripples. Sharp macro focus on water droplets on material surface. Dramatic side lighting creating caustic light patterns through water. Commercial product photography, ultra realistic detail, 8K resolution."

-----------------------------------------------------------
ANTI-PATTERNS (NEVER DO THESE)
-----------------------------------------------------------
- NEVER write generic prompts like "product on white background with studio lighting"
- NEVER ignore the surrounding text context — each image must relate to what's being discussed
- NEVER use vague descriptions like "nice lighting" or "good angle" — be SPECIFIC
- NEVER repeat the same composition/angle for multiple placeholders — each must be visually distinct
${
  includeManualBrandColors
    ? "- NEVER forget to include exact brand colors with hex codes in the prompt"
    : "- NEVER invent conflicting hex palettes when a brand-guide image is the color source"
}
- NEVER write sectioned/bulleted prompts — write flowing visual briefs

PROMPT LENGTH: Each visualBrief must be 6-10 detailed sentences as a flowing paragraph.

===============================================================
RUNTIME INPUTS FOR THIS PRODUCT
===============================================================

Brand design specs:
${visualDesignSpecs}

${
  custom
    ? `CUSTOM INSTRUCTIONS — treat as mandatory unless unsafe:\n${custom}\n`
    : ""
}
Product data:
${JSON.stringify(params.product, null, 2)}
`.trim();
}

export function buildDescriptionResponseSchema(imageCount: number) {
  const maxItems = Math.min(
    VISUALIZER_MAX_IMAGES,
    Math.max(1, Math.floor(imageCount) || 1)
  );
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      description: { type: "string" },
      imagePlaceholders: {
        type: "array",
        maxItems,
        minItems: maxItems,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer", minimum: 1, maximum: maxItems },
            visualBrief: { type: "string" },
            alt: { type: "string" },
          },
          required: ["index", "visualBrief", "alt"],
        },
      },
      notes: { type: "string" },
    },
    required: ["description", "imagePlaceholders", "notes"],
  } as const;
}

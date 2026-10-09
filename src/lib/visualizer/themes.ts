/**
 * Visual themes for Products Visualizer. A theme is one fixed photography
 * recipe added to every image of every product, so a whole store shares one
 * look. Stored in `settings.images.style`; "white", "editorial" and "custom"
 * are older values that still parse but are no longer offered.
 */

export const VISUALIZER_THEME_IDS = [
  "auto",
  "lifestyle",
  "studio",
  "sport",
  "outdoor",
  "luxury",
  "minimal",
  "cozy",
  "playful",
  "tech",
] as const;

export const VISUALIZER_LEGACY_THEME_IDS = ["white", "editorial", "custom"] as const;

export type VisualizerThemeId = (typeof VISUALIZER_THEME_IDS)[number];
export type VisualizerImageStyle = VisualizerThemeId | (typeof VISUALIZER_LEGACY_THEME_IDS)[number];

export const VISUALIZER_STYLE_VALUES = [...VISUALIZER_THEME_IDS, ...VISUALIZER_LEGACY_THEME_IDS] as const;

export const DEFAULT_VISUALIZER_THEME: VisualizerImageStyle = "lifestyle";

export interface VisualizerThemeDefinition {
  id: VisualizerImageStyle;
  name: string;
  description: string;
  /** Sample picture in /public, null for Auto and legacy values. */
  sample: string | null;
  /** The recipe added to every image prompt; null lets the planner choose per product. */
  recipe: string | null;
}

export const VISUALIZER_THEMES: Record<VisualizerImageStyle, VisualizerThemeDefinition> = {
  auto: {
    id: "auto",
    name: "Auto",
    description: "The planner picks the best look for each product",
    sample: null,
    recipe: null,
  },
  lifestyle: {
    id: "lifestyle",
    name: "Lifestyle",
    description: "Real everyday use, natural light",
    sample: "/visualizer/themes/lifestyle.webp",
    recipe:
      "Lifestyle: the product in real, everyday use in a natural, believable home or daily setting; soft natural window light; warm, true-to-life colours; a candid, unstaged feel.",
  },
  studio: {
    id: "studio",
    name: "Studio",
    description: "Clean backdrop, softbox lighting",
    sample: "/visualizer/themes/studio.webp",
    recipe:
      "Studio: controlled softbox lighting on a seamless neutral backdrop (light grey or a soft solid colour); crisp, soft shadows; polished catalogue finish; minimal props.",
  },
  sport: {
    id: "sport",
    name: "Sport",
    description: "Motion, energy, bold light",
    sample: "/visualizer/themes/sport.webp",
    recipe:
      "Sport and action: dynamic athletic moments with motion and energy on tracks, courts, gyms or trails; crisp directional sunlight or punchy rim light; high contrast and saturated colour; low or dynamic camera angles.",
  },
  outdoor: {
    id: "outdoor",
    name: "Outdoor",
    description: "Nature, daylight, adventure",
    sample: "/visualizer/themes/outdoor.webp",
    recipe:
      "Outdoor: natural landscapes such as forest, mountains, beach or park in daylight; golden-hour or soft overcast light; earthy greens and blues; a fresh, adventurous mood.",
  },
  luxury: {
    id: "luxury",
    name: "Luxury",
    description: "Rich materials, dramatic light",
    sample: "/visualizer/themes/luxury.webp",
    recipe:
      "Luxury: premium surfaces such as marble, velvet, brushed metal and dark wood; low-key dramatic lighting with soft specular highlights; deep, rich tones; an elegant, uncluttered composition.",
  },
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "Calm tones, open space",
    sample: "/visualizer/themes/minimal.webp",
    recipe:
      "Minimal: clean, airy compositions with generous negative space; soft diffused light; a muted neutral palette of white, beige and soft grey; one or two simple props at most.",
  },
  cozy: {
    id: "cozy",
    name: "Cozy Home",
    description: "Warm interiors, soft textiles",
    sample: "/visualizer/themes/cozy.webp",
    recipe:
      "Cozy home: warm interiors with soft textiles, wood and plants; warm lamp or late-afternoon light; an inviting, comfortable mood with homely props.",
  },
  playful: {
    id: "playful",
    name: "Playful",
    description: "Bright colours, fun props",
    sample: "/visualizer/themes/playful.webp",
    recipe:
      "Playful: bright cheerful colours, fun props and playful settings such as a playroom, garden or party; bright, even light; a joyful, friendly mood.",
  },
  tech: {
    id: "tech",
    name: "Tech",
    description: "Sleek surfaces, cool light",
    sample: "/visualizer/themes/tech.webp",
    recipe:
      "Tech: sleek modern surfaces such as glass, dark matte and metal; cool blue or neutral lighting with subtle glows and reflections; a precise, futuristic, clean composition.",
  },
  white: {
    id: "white",
    name: "White background",
    description: "Seamless pure white",
    sample: null,
    recipe: "White background: seamless pure white backdrop, soft grounded shadow, no decorative clutter.",
  },
  editorial: {
    id: "editorial",
    name: "Editorial",
    description: "Art-directed campaign look",
    sample: null,
    recipe: "Editorial: premium art-directed campaign photography with designed lighting and a polished composition.",
  },
  custom: {
    id: "custom",
    name: "Custom",
    description: "Follow the custom instructions only",
    sample: null,
    recipe: null,
  },
};

export function getVisualizerTheme(id: unknown): VisualizerThemeDefinition {
  return typeof id === "string" && id in VISUALIZER_THEMES
    ? VISUALIZER_THEMES[id as VisualizerImageStyle]
    : VISUALIZER_THEMES[DEFAULT_VISUALIZER_THEME];
}

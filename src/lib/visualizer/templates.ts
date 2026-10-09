/**
 * Fixed page templates for Products Visualizer. The planner writes plain text
 * only; this module turns it into the same HTML for every product of a layout,
 * with the [imageplaceholder-N] markers placed by code. All text is escaped, so
 * nothing the model writes can become markup.
 */
import {
  clampVisualizerImageCount,
  type VisualizerLayoutId,
  normalizeVisualizerLayoutId,
} from "@/lib/visualizer/layouts";

export interface VisualizerSectionCopy {
  heading: string;
  body: string;
  bullets: string[];
}

export interface VisualizerHighlight {
  value: string;
  label: string;
}

/** Copy of the Showcase banner card; its gallery slides carry no copy. */
export interface VisualizerShowcaseCopy {
  tagline: string;
  badge: string;
  highlights: VisualizerHighlight[];
  promise: string;
  galleryCount: number;
}

export interface VisualizerPageCopy {
  headline: string;
  intro: string;
  closing: string;
  /** One section per image slot: sections[0] belongs to [imageplaceholder-1]. Empty for Showcase. */
  sections: VisualizerSectionCopy[];
  showcase?: VisualizerShowcaseCopy;
}

export type VisualizerTextDirection = "ltr" | "rtl";

export interface VisualizerTemplateOptions {
  direction: VisualizerTextDirection;
  /** Brand colours [primary, secondary, accent] when branding uses a palette. */
  brandColors?: string[];
}

export const VISUALIZER_COPY_LIMITS = {
  headline: 90,
  intro: 600,
  closing: 280,
  heading: 80,
  body: 480,
  /** Body of a card, slide or grid cell, where space is narrow. */
  compactBody: 240,
  bullet: 90,
  bullets: 3,
  tagline: 40,
  badge: 28,
  highlightValue: 14,
  highlightLabel: 40,
  highlightsMin: 2,
  highlightsMax: 3,
  promise: 60,
} as const;

export function visualizerMarker(index: number): string {
  return `[imageplaceholder-${index}]`;
}

/** Slots rendered as narrow cards (grid, carousel, mosaic detail grid). */
export function isCompactSlot(layoutId: VisualizerLayoutId, index: number): boolean {
  if (layoutId === "feature-grid" || layoutId === "carousel") return true;
  if (layoutId === "mosaic") return index >= 3;
  return false;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text from a model field: no tags, markdown emphasis, markers or runs of whitespace. */
export function toPlainText(value: unknown): string {
  return String(value ?? "")
    .replace(/<\/?[a-z!][^>]*>/gi, " ")
    .replace(/\[imageplaceholder-\d+\]/gi, " ")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SENTENCE_END = /[.!?؟。]/;

/** Shorten to `max` characters at a sentence end, else at a word boundary; never mid-word. */
export function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = value.slice(0, max);
  for (let i = head.length - 1; i >= Math.floor(max * 0.5); i -= 1) {
    if (SENTENCE_END.test(head[i]) && (i + 1 === value.length || /\s/.test(value[i + 1]))) {
      return head.slice(0, i + 1).trim();
    }
  }
  const space = head.lastIndexOf(" ");
  const cut = space > max * 0.5 ? head.slice(0, space) : head.slice(0, max - 1);
  return `${cut.replace(/[\s,;:،-]+$/, "")}…`;
}

const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
const LETTERS = /\p{L}/gu;

/** Right-to-left when most letters of the copy are Arabic, Hebrew, Persian or Urdu. */
export function detectTextDirection(texts: string[]): VisualizerTextDirection {
  const joined = texts.join(" ");
  const letters = joined.match(LETTERS)?.length ?? 0;
  if (letters === 0) return "ltr";
  const rtl = joined.match(RTL_CHARS)?.length ?? 0;
  return rtl / letters >= 0.4 ? "rtl" : "ltr";
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexLuminance(hex: string): number {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const channel = (offset: number) => {
    const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Dark text on light fills, white text on dark fills. */
function textOn(fill: string): string {
  return hexLuminance(fill) > 0.35 ? "#111827" : "#FFFFFF";
}

function validHex(value: string | undefined): string | undefined {
  return value && HEX_COLOR.test(value.trim()) ? value.trim() : undefined;
}

function brandAccents(colors: string[] | undefined): { heading?: string; line?: string } {
  const primary = validHex(colors?.[0]);
  const accent = validHex(colors?.[2]) ?? validHex(colors?.[1]);
  return {
    // Headings sit on a white page: a light primary colour would be unreadable.
    heading: primary && hexLuminance(primary) < 0.4 ? primary : undefined,
    line: accent ?? primary,
  };
}

type Theme = { headingColor: string; lineColor?: string };

function media(index: number, style: string): string {
  return `<div style="${style};aspect-ratio:1/1;overflow:hidden;border-radius:8px">${visualizerMarker(index)}</div>`;
}

function headingAndBody(section: VisualizerSectionCopy, theme: Theme, compact: boolean): string {
  const headingSize = compact ? "1.05em" : "1.25em";
  return (
    `<h3 style="margin:0 0 0.5rem;font-size:${headingSize};line-height:1.3;${theme.headingColor}">${escapeHtml(section.heading)}</h3>` +
    `<p style="margin:0">${escapeHtml(section.body)}</p>`
  );
}

function bulletList(section: VisualizerSectionCopy): string {
  if (section.bullets.length === 0) return "";
  return `<ul style="margin:0.75rem 0 0;padding-inline-start:1.25rem">${section.bullets
    .map((bullet) => `<li style="margin:0.25rem 0">${escapeHtml(bullet)}</li>`)
    .join("")}</ul>`;
}

function copyBlock(section: VisualizerSectionCopy, theme: Theme, compact: boolean): string {
  return headingAndBody(section, theme, compact) + bulletList(section);
}

function splitRow(index: number, section: VisualizerSectionCopy, theme: Theme, mediaFirst: boolean): string {
  const square = media(index, "flex:0 1 320px;width:100%;max-width:320px");
  const copy = `<div style="flex:1 1 260px;min-width:220px">${copyBlock(section, theme, false)}</div>`;
  return `<section style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:center;margin:2rem 0">${
    mediaFirst ? square + copy : copy + square
  }</section>`;
}

function card(index: number, section: VisualizerSectionCopy, theme: Theme): string {
  return `<div>${media(index, "width:100%;margin:0 0 0.75rem")}${copyBlock(section, theme, true)}</div>`;
}

function grid(indexes: number[], sections: VisualizerSectionCopy[], theme: Theme, minWidth: number): string {
  return `<section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${minWidth}px,1fr));gap:1.5rem;margin:2rem 0">${indexes
    .map((index) => card(index, sections[index - 1], theme))
    .join("")}</section>`;
}

function renderBody(layoutId: VisualizerLayoutId, sections: VisualizerSectionCopy[], theme: Theme): string {
  const n = sections.length;
  const indexes = Array.from({ length: n }, (_, i) => i + 1);
  switch (layoutId) {
    case "zigzag":
      return indexes.map((index) => splitRow(index, sections[index - 1], theme, index % 2 === 1)).join("");
    case "feature-grid":
      return grid(indexes, sections, theme, 200);
    case "carousel":
      return `<section style="margin:2rem 0"><div style="display:flex;gap:1rem;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:0.5rem">${indexes
        .map(
          (index) =>
            `<div style="flex:0 0 min(72%,280px);scroll-snap-align:start">${media(index, "width:100%;margin:0 0 0.75rem")}${copyBlock(
              sections[index - 1],
              theme,
              true
            )}</div>`
        )
        .join("")}</div></section>`;
    case "stacked-squares":
      return indexes
        .map((index) => {
          const section = sections[index - 1];
          return `<section style="margin:2.5rem 0">${headingAndBody(section, theme, false)}${media(
            index,
            "margin:1.25rem auto;width:100%;max-width:420px"
          )}${bulletList(section)}</section>`;
        })
        .join("");
    case "spotlight":
      return indexes
        .map((index) =>
          index === 1
            ? `<section style="margin:2rem 0">${media(1, "margin:0 auto 1.25rem;width:100%;max-width:480px")}${copyBlock(
                sections[0],
                theme,
                false
              )}</section>`
            : splitRow(index, sections[index - 1], theme, index % 2 === 0)
        )
        .join("");
    case "mosaic":
      return [
        splitRow(1, sections[0], theme, true),
        splitRow(2, sections[1], theme, false),
        grid(indexes.slice(2), sections, theme, 160),
      ].join("");
    case "showcase":
      throw new Error("Showcase is rendered by renderShowcase");
  }
}

const SHOWCASE_DARK = "#1F3D2E";
const SHOWCASE_ACCENT = "#F6D04D";

function renderShowcase(copy: VisualizerPageCopy, showcase: VisualizerShowcaseCopy, rtl: boolean, colors?: string[]): string {
  const primary = validHex(colors?.[0]);
  const dark = primary && hexLuminance(primary) < 0.4 ? primary : SHOWCASE_DARK;
  const accent = validHex(colors?.[2]) ?? validHex(colors?.[1]) ?? SHOWCASE_ACCENT;
  const onDark = textOn(dark);
  const onAccent = textOn(accent);
  const tagline = escapeHtml(showcase.tagline);
  const strip = `<div style="background:${accent};color:${onAccent};overflow:hidden;white-space:nowrap;padding:0.45rem 0;font-weight:800;font-size:0.85em;letter-spacing:0.08em;text-transform:uppercase">${Array.from(
    { length: 8 },
    () => `<span style="display:inline-block;padding:0 1.25rem">${tagline}</span><span aria-hidden="true">———</span>`
  ).join("")}</div>`;

  const tiles = showcase.highlights
    .map((highlight, i) => {
      const last = i === showcase.highlights.length - 1;
      const fill = last ? `background:${accent};color:${onAccent};border-radius:6px;` : "";
      return `<div style="flex:1 1 84px;min-width:84px;padding:0.6rem 0.5rem;text-align:center;${fill}"><div style="font-size:1.45em;font-weight:800;line-height:1.15">${escapeHtml(
        highlight.value
      )}</div><div style="margin-top:0.25rem;font-size:0.8em;line-height:1.35">${escapeHtml(highlight.label)}</div></div>`;
    })
    .join("");

  const card = [
    `<div style="position:relative;max-width:860px;margin:0 auto;background:#FFFFFF;color:#1F2937;border-radius:6px;box-shadow:0 18px 40px rgba(0,0,0,0.22);padding:clamp(1rem,3vw,2rem);display:flex;flex-wrap:wrap;gap:1.75rem;align-items:center">`,
    `<div style="flex:0 1 280px;width:100%;max-width:300px;margin:0 auto;position:relative">`,
    media(2, "width:100%;background:#FFFFFF"),
    `<div style="position:absolute;bottom:-0.75rem;inset-inline-start:-0.5rem;max-width:75%;background:${dark};color:${onDark};padding:0.5rem 0.75rem;border-radius:6px;font-weight:700;font-size:0.85em;line-height:1.25;box-shadow:0 6px 16px rgba(0,0,0,0.18)">${escapeHtml(showcase.badge)}</div>`,
    `</div>`,
    `<div style="flex:1 1 300px;min-width:0">`,
    `<h2 style="margin:0 0 0.6rem;font-size:1.7em;line-height:1.2;color:${dark}">${escapeHtml(copy.headline)}</h2>`,
    `<p style="margin:0">${escapeHtml(copy.intro)}</p>`,
    `<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:stretch;margin:1.1rem 0">${tiles}</div>`,
    `<div style="display:inline-block;background:${dark};color:${onDark};padding:0.7rem 1.2rem;border-radius:6px;font-weight:700">${escapeHtml(showcase.promise)}</div>`,
    `</div>`,
    `</div>`,
  ].join("");

  const hero = `<section style="position:relative;overflow:hidden;padding:clamp(1.25rem,5vw,3.5rem) clamp(0.75rem,4vw,3rem)"><div style="position:absolute;top:0;right:0;bottom:0;left:0">${visualizerMarker(
    1
  )}</div>${card}</section>`;

  const slides = Array.from({ length: showcase.galleryCount }, (_, i) => i + 3)
    .map(
      (index) =>
        `<div style="flex:0 0 min(78%,440px);scroll-snap-align:start;aspect-ratio:4/5;overflow:hidden;border-radius:6px">${visualizerMarker(index)}</div>`
    )
    .join("");
  const gallery = `<section style="margin:1.5rem 0 0"><div style="display:flex;gap:0.75rem;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding-bottom:0.5rem">${slides}</div></section>`;

  const closing = copy.closing
    ? `<p style="margin:1.5rem 0 0;font-weight:600;text-align:center">${escapeHtml(copy.closing)}</p>`
    : "";
  return `<article dir="${rtl ? "rtl" : "ltr"}" style="max-width:1100px;margin:0 auto;line-height:1.55;text-align:${
    rtl ? "right" : "left"
  }">${strip}${hero}${gallery}${closing}</article>`;
}

/**
 * The page for one product. Every marker 1..N appears exactly once, in the
 * position the layout fixes; only the text differs between products.
 */
export function renderVisualizerPage(
  layoutIdInput: VisualizerLayoutId | string,
  copy: VisualizerPageCopy,
  options: VisualizerTemplateOptions
): string {
  const layoutId = normalizeVisualizerLayoutId(layoutIdInput);
  if (layoutId === "showcase") {
    if (!copy.showcase) throw new Error("Showcase copy is missing");
    const total = copy.showcase.galleryCount + 2;
    if (clampVisualizerImageCount(layoutId, total) !== total) {
      throw new Error(`Layout ${layoutId} cannot hold ${total} images`);
    }
    return renderShowcase(copy, copy.showcase, options.direction === "rtl", options.brandColors);
  }
  const n = clampVisualizerImageCount(layoutId, copy.sections.length);
  if (n !== copy.sections.length) {
    throw new Error(`Layout ${layoutId} cannot hold ${copy.sections.length} images`);
  }
  const accents = brandAccents(options.brandColors);
  const theme: Theme = { headingColor: accents.heading ? `color:${accents.heading}` : "", lineColor: accents.line };
  const rtl = options.direction === "rtl";
  const header = [
    `<header style="margin:0 0 1.5rem">`,
    `<h2 style="margin:0 0 0.75rem;font-size:1.6em;line-height:1.25;${theme.headingColor}">${escapeHtml(copy.headline)}</h2>`,
    theme.lineColor
      ? `<div style="width:56px;height:3px;border-radius:2px;margin:0 0 1rem;background:${theme.lineColor}"></div>`
      : "",
    `<p style="margin:0">${escapeHtml(copy.intro)}</p>`,
    `</header>`,
  ].join("");
  const closing = copy.closing
    ? `<p style="margin:2rem 0 0;font-weight:600">${escapeHtml(copy.closing)}</p>`
    : "";
  return `<article dir="${rtl ? "rtl" : "ltr"}" style="max-width:960px;margin:0 auto;line-height:1.6;text-align:${
    rtl ? "right" : "left"
  }">${header}${renderBody(layoutId, copy.sections, theme)}${closing}</article>`;
}

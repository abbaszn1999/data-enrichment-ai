"use client";

import { cn } from "@/lib/utils";
import {
  SAMPLE_LINKS,
  SIZE_SCALE,
  fontStack,
  type LinkTemplateId,
  type WidgetStyle,
} from "@/lib/customize-widgets";

export function LinksWidgetPreview({
  style,
  items = SAMPLE_LINKS,
  quiet = false,
}: {
  style: WidgetStyle;
  items?: readonly { id: string; label: string }[];
  quiet?: boolean;
}) {
  const scale = SIZE_SCALE[style.size];
  const template = style.template as LinkTemplateId;
  const css = {
    fontFamily: fontStack(style.font),
    background: style.backgroundColor,
    color: style.textColor,
    padding: scale.pad,
  } as const;

  return (
    <section style={css} className="cp-preview-surface rounded-xl">
      <h3
        style={{
          color: style.headingColor,
          fontSize: scale.heading,
          fontWeight: 650,
          letterSpacing: "-0.02em",
          marginBottom: scale.pad * 0.7,
        }}
      >
        {style.heading}
      </h3>
      {template === "pills" ? (
        <div className="flex flex-wrap gap-2">
          {items.map((link) => (
            <span
              key={link.id}
              className="inline-flex items-center rounded-full border px-3 py-1"
              style={{
                fontSize: scale.item,
                borderColor: style.accentColor + "33",
                color: style.headingColor,
                background: style.accentColor + "0D",
              }}
            >
              {link.label}
            </span>
          ))}
        </div>
      ) : null}
      {template === "tiles" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {items.map((link, i) => (
            <div key={link.id} className="min-w-0">
              <div
                className="mb-1.5 aspect-[4/3] rounded-lg"
                style={{
                  background: `color-mix(in srgb, ${style.accentColor} ${12 + i * 6}%, ${style.backgroundColor})`,
                }}
              />
              <p
                className="truncate"
                style={{ fontSize: scale.item, color: style.headingColor, fontWeight: 550 }}
              >
                {link.label}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {template === "circles" ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {items.map((link, i) => (
            <div key={link.id} className="w-[72px] shrink-0 text-center">
              <div
                className="mx-auto mb-1.5 h-14 w-14 rounded-full"
                style={{
                  background: `color-mix(in srgb, ${style.accentColor} ${18 + i * 8}%, ${style.backgroundColor})`,
                  boxShadow: `inset 0 0 0 1px ${style.accentColor}22`,
                }}
              />
              <p
                className="line-clamp-2 leading-tight"
                style={{ fontSize: Math.max(10, scale.item - 1), color: style.headingColor }}
              >
                {link.label}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {template === "rail" ? (
        <nav className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {items.map((link, i) => (
            <span key={link.id} className="inline-flex items-center gap-1">
              <span
                className="underline-offset-4 hover:underline"
                style={{
                  fontSize: scale.item,
                  color: style.headingColor,
                  textDecorationColor: style.accentColor,
                }}
              >
                {link.label}
              </span>
              {i < items.length - 1 ? (
                <span style={{ color: style.accentColor, opacity: 0.35, fontSize: scale.item }}>
                  /
                </span>
              ) : null}
            </span>
          ))}
        </nav>
      ) : null}
      {template === "editorial" ? (
        <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
          <div
            className="rounded-xl p-4"
            style={{
              background: `color-mix(in srgb, ${style.accentColor} 10%, ${style.backgroundColor})`,
            }}
          >
            <p
              className="mb-1 text-[10px] uppercase tracking-[0.16em]"
              style={{ color: style.accentColor }}
            >
              Featured
            </p>
            <p style={{ fontSize: scale.heading, color: style.headingColor, fontWeight: 650 }}>
              {items[0]?.label}
            </p>
            <p className="mt-1" style={{ fontSize: scale.item }}>
              Continue browsing this cluster — same catalog, tighter intent.
            </p>
          </div>
          <ul className="space-y-2">
            {items.slice(1).map((link) => (
              <li
                key={link.id}
                className="flex items-center justify-between border-b pb-2"
                style={{ borderColor: style.accentColor + "22", fontSize: scale.item }}
              >
                <span style={{ color: style.headingColor }}>{link.label}</span>
                <span style={{ color: style.accentColor }}>→</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {quiet ? null : (
      <p
        className={cn("mt-3 text-[10px] uppercase tracking-wide")}
        style={{ opacity: 0.45 }}
      >
        Preview · live collection data fills this after extract
      </p>
      )}
    </section>
  );
}

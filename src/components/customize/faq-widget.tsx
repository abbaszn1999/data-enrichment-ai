"use client";

import { useState } from "react";
import {
  SAMPLE_FAQS,
  SIZE_SCALE,
  fontStack,
  type FaqTemplateId,
  type WidgetStyle,
} from "@/lib/customize-widgets";

export function FaqWidgetPreview({
  style,
  items = SAMPLE_FAQS,
  quiet = false,
}: {
  style: WidgetStyle;
  items?: readonly { q: string; a: string }[];
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(0);
  const scale = SIZE_SCALE[style.size];
  const template = style.template as FaqTemplateId;
  const css = {
    fontFamily: fontStack(style.font),
    background: style.backgroundColor,
    color: style.textColor,
    padding: scale.pad + 4,
  } as const;

  const toggle = (index: number) => {
    setOpen((prev) => (prev === index ? -1 : index));
  };

  return (
    <section style={css} className="rounded-xl">
      <h3
        style={{
          color: style.headingColor,
          fontSize: scale.heading,
          fontWeight: 650,
          letterSpacing: "-0.02em",
          marginBottom: scale.pad,
        }}
      >
        {style.heading}
      </h3>

      {template === "split" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item, i) => (
            <FaqItem
              key={item.q}
              item={item}
              open={open === i}
              onToggle={() => toggle(i)}
              style={style}
              scale={scale}
              template={template}
            />
          ))}
        </div>
      ) : (
        <div className={template === "cards" ? "space-y-2" : "space-y-0"}>
          {items.map((item, i) => (
            <FaqItem
              key={item.q}
              item={item}
              open={open === i}
              onToggle={() => toggle(i)}
              style={style}
              scale={scale}
              template={template}
            />
          ))}
        </div>
      )}
      {quiet ? null : (
      <p className="mt-3 text-[10px] uppercase tracking-wide" style={{ opacity: 0.45 }}>
        Preview · FAQ sits above the product grid on the live collection page
      </p>
      )}
    </section>
  );
}

function FaqItem({
  item,
  open,
  onToggle,
  style,
  scale,
  template,
}: {
  item: { q: string; a: string };
  open: boolean;
  onToggle: () => void;
  style: WidgetStyle;
  scale: { heading: number; item: number; pad: number };
  template: FaqTemplateId;
}) {
  const bordered = template === "dividers" || template === "editorial";
  const card = template === "cards" || template === "split";
  const accent = template === "accent";

  return (
    <div
      className={card ? "rounded-xl px-3" : ""}
      style={{
        borderBottom: bordered ? `1px solid ${style.accentColor}22` : undefined,
        background: card
          ? `color-mix(in srgb, ${style.accentColor} 6%, ${style.backgroundColor})`
          : undefined,
        boxShadow: accent && open ? `inset 3px 0 0 ${style.accentColor}` : undefined,
        paddingLeft: accent ? 12 : undefined,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 py-3 text-left"
      >
        <span
          style={{
            color: style.headingColor,
            fontSize: template === "editorial" ? scale.heading - 2 : scale.item + 1,
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          {item.q}
        </span>
        <span
          className="shrink-0 tabular-nums"
          style={{ color: style.accentColor, fontSize: scale.item }}
        >
          {open ? "–" : "+"}
        </span>
      </button>
      {open ? (
        <p
          className="pb-3 leading-relaxed"
          style={{ fontSize: scale.item, maxWidth: "42rem" }}
        >
          {item.a}
        </p>
      ) : null}
    </div>
  );
}

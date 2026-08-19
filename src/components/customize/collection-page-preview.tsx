"use client";

import type { WidgetStyle } from "@/lib/customize-widgets";
import { FaqWidgetPreview } from "./faq-widget";
import { LinksWidgetPreview } from "./links-widget";

export function CollectionPagePreview({
  title,
  description,
  productCount,
  faqStyle,
  linksStyle,
  faqs,
  links,
  focus = "both",
}: {
  title: string;
  seoTitle?: string;
  seoDescription?: string;
  description: string;
  productCount?: number;
  faqStyle: WidgetStyle;
  linksStyle: WidgetStyle;
  faqs?: readonly { q: string; a: string }[];
  links?: readonly { id: string; label: string }[];
  focus?: "faq" | "links" | "both";
}) {
  const showFaq = focus !== "links";
  const showLinks = focus !== "faq";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      {showFaq ? (
        <>
          <PlacementNote>
            Best place · FAQ above the products — shoppers read answers before the
            grid, and Google sees FAQPage on the collection URL.
          </PlacementNote>
          <FaqWidgetPreview style={faqStyle} items={faqs} quiet />
        </>
      ) : null}

      <div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-lg border border-border/70 bg-muted/40"
            />
          ))}
        </div>
        {productCount != null ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {productCount.toLocaleString("en-US")} products in this collection
          </p>
        ) : null}
      </div>

      {showLinks ? (
        <>
          <PlacementNote>
            Best place · Internal links below the products — a next step after the
            grid, crawlable links between collections and guides.
          </PlacementNote>
          <LinksWidgetPreview style={linksStyle} items={links} quiet />
        </>
      ) : null}
    </div>
  );
}

function PlacementNote({ children }: { children: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

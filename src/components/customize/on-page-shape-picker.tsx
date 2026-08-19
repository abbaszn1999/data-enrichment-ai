"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  FAQ_TEMPLATES,
  LINK_TEMPLATES,
  loadCustomizeWidgets,
  saveCustomizeWidgets,
  type WidgetStyle,
} from "@/lib/customize-widgets";
import { cn } from "@/lib/utils";
import { FaqWidgetPreview } from "./faq-widget";
import { LinksWidgetPreview } from "./links-widget";
import type {
  CollectionContent,
  ProposedCollection,
} from "@/components/market-research/workspace-data";

export function OnPageShapePicker({
  content,
}: {
  collection: ProposedCollection;
  content: CollectionContent;
}) {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params.workspaceSlug ?? "";
  const [links, setLinks] = useState<WidgetStyle | null>(null);
  const [faq, setFaq] = useState<WidgetStyle | null>(null);

  useEffect(() => {
    const saved = loadCustomizeWidgets(slug);
    setLinks(saved.links);
    setFaq(saved.faq);
  }, [slug]);

  useEffect(() => {
    if (!links || !faq) return;
    saveCustomizeWidgets(slug, { links, faq });
  }, [slug, links, faq]);

  if (!links || !faq) return null;

  const linkItems = content.links.map((link, i) => ({
    id: link.href || `l-${i}`,
    label: link.label,
  }));

  return (
    <div className="space-y-6 px-4 pb-6">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Choose a shape only. Font, color and size are edited in Customize.
        FAQ injects above the product grid, internal links below it.
      </p>

      <div className="rounded-xl border border-border/70 p-3">
        <p className="mb-3 text-[10px] uppercase tracking-wide text-muted-foreground">
          Title tag
        </p>
        <p className="text-sm font-semibold">{content.seoTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {content.seoDescription}
        </p>
      </div>

      <div className="space-y-3">
        <ShapeRow
          label="FAQ shape · above products"
          templates={FAQ_TEMPLATES}
          value={faq.template}
          onChange={(template) =>
            setFaq((prev) => (prev ? { ...prev, template } : prev))
          }
        />
        <div className="rounded-xl border border-border/70 p-3">
          <FaqWidgetPreview style={faq} items={content.faqs} quiet />
        </div>
      </div>

      <div className="space-y-3">
        <ShapeRow
          label="Links shape · below products"
          templates={LINK_TEMPLATES}
          value={links.template}
          onChange={(template) =>
            setLinks((prev) => (prev ? { ...prev, template } : prev))
          }
        />
        <div className="rounded-xl border border-border/70 p-3">
          <LinksWidgetPreview style={links} items={linkItems} quiet />
        </div>
      </div>
    </div>
  );
}

function ShapeRow({
  label,
  templates,
  value,
  onChange,
}: {
  label: string;
  templates: readonly { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onChange(template.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              value === template.id
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/70 text-muted-foreground hover:text-foreground"
            )}
          >
            {template.name}
          </button>
        ))}
      </div>
    </div>
  );
}

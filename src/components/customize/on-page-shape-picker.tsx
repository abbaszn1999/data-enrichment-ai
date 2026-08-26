"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceContext } from "@/app/(dashboard)/w/[workspaceSlug]/workspace-context";
import {
  FAQ_TEMPLATES,
  LINK_TEMPLATES,
  faqSnippet,
  linksSnippet,
  loadCustomizeWidgets,
  saveCustomizeWidgets,
  type WidgetStyle,
} from "@/lib/customize-widgets";
import {
  fetchWidgetSettings,
  saveWidgetSettings,
} from "@/lib/widget-settings-api";
import { cn } from "@/lib/utils";
import { FaqWidgetPreview } from "./faq-widget";
import { LinksWidgetPreview } from "./links-widget";
import { SnippetBlock, useAppOrigin } from "./snippet-block";
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
  const { workspace } = useWorkspaceContext();
  const workspaceId = workspace?.id;
  const appOrigin = useAppOrigin();

  // Seeded from localStorage so the sheet paints the merchant's real shape on
  // the first frame; the database load below corrects it if they differ.
  const [links, setLinks] = useState<WidgetStyle>(
    () => loadCustomizeWidgets(slug).links
  );
  const [faq, setFaq] = useState<WidgetStyle>(
    () => loadCustomizeWidgets(slug).faq
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  // The database is the version the storefront actually serves, so it wins over
  // whatever this browser happens to have cached.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetchWidgetSettings(workspaceId)
      .then((settings) => {
        if (cancelled || !settings) return;
        setLinks(settings.links);
        setFaq(settings.faq);
        saveCustomizeWidgets(slug, settings);
      })
      .catch((err) =>
        console.warn("[OnPageShapePicker] Could not load widget settings:", err)
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, slug]);

  // Rapid template clicking would otherwise fire a write per click.
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const persist = useCallback(
    (next: { links: WidgetStyle; faq: WidgetStyle }) => {
      saveCustomizeWidgets(slug, next);
      if (!workspaceId) return;

      if (timer.current) window.clearTimeout(timer.current);
      setSaving(true);
      timer.current = window.setTimeout(() => {
        saveWidgetSettings(workspaceId, slug, next)
          .then(() => setSavedAt(Date.now()))
          .catch((err) => {
            console.error("[OnPageShapePicker] Save failed:", err);
            toast.error(
              err instanceof Error ? err.message : "Could not save the shape"
            );
          })
          .finally(() => setSaving(false));
      }, 500);
    },
    [slug, workspaceId]
  );

  const chooseFaq = (template: string) => {
    const nextFaq = { ...faq, template };
    setFaq(nextFaq);
    persist({ links, faq: nextFaq });
  };

  const chooseLinks = (template: string) => {
    const nextLinks = { ...links, template };
    setLinks(nextLinks);
    persist({ links: nextLinks, faq });
  };

  const linkItems = content.links.map((link, i) => ({
    id: link.href || `l-${i}`,
    label: link.label,
  }));

  return (
    <div className="space-y-6 px-4 pb-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Choose a shape only. Font, color and size are edited in Customize, and
          the shape you pick here is the one saved there. FAQ injects above the
          product grid, internal links below it.
        </p>
        <SaveState saving={saving} savedAt={savedAt} />
      </div>

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
          onChange={chooseFaq}
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
          onChange={chooseLinks}
        />
        <div className="rounded-xl border border-border/70 p-3">
          <LinksWidgetPreview style={links} items={linkItems} quiet />
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-border/70 p-3">
        <div>
          <p className="text-xs font-semibold tracking-tight">HTML snippet</p>
          <p className="text-[11px] text-muted-foreground">
            Paste each block into the collection template: FAQ above the product
            grid, internal links below it.
          </p>
        </div>
        <SnippetBlock
          label="FAQ"
          value={faqSnippet("{{ collection.handle }}", appOrigin)}
        />
        <SnippetBlock
          label="Internal links"
          value={linksSnippet("{{ collection.handle }}", appOrigin)}
        />
      </section>
    </div>
  );
}

function SaveState({ saving, savedAt }: { saving: boolean; savedAt: number }) {
  if (saving) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving
      </span>
    );
  }
  if (savedAt > 0) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  return null;
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import { Check, Loader2, Paintbrush, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useWorkspaceContext } from "@/app/(dashboard)/w/[workspaceSlug]/workspace-context";
import {
  FAQ_TEMPLATES,
  FONT_OPTIONS,
  LINK_TEMPLATES,
  faqSnippet,
  linksSnippet,
  loadCustomizeWidgets,
  saveCustomizeWidgets,
  type WidgetKind,
  type WidgetStyle,
  type FontChoice,
  type SizeChoice,
} from "@/lib/customize-widgets";
import {
  fetchWidgetSettings,
  saveWidgetSettings,
} from "@/lib/widget-settings-api";
import { CollectionPagePreview } from "./collection-page-preview";
import { SnippetBlock, useAppOrigin } from "./snippet-block";

export function CustomizePage() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params.workspaceSlug ?? "";
  const { workspace } = useWorkspaceContext();

  const [kind, setKind] = useState<WidgetKind>("faq");
  const [links, setLinks] = useState<WidgetStyle | null>(null);
  const [faq, setFaq] = useState<WidgetStyle | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Collection naming prefix settings
  const [namingPrefix, setNamingPrefix] = useState("AI");
  const [storeUrl, setStoreUrl] = useState("");
  const [storeProvider, setStoreProvider] = useState<string | null>(null);
  const [savingPrefix, setSavingPrefix] = useState(false);
  const appOrigin = useAppOrigin();

  // Initial load from localStorage
  useEffect(() => {
    const saved = loadCustomizeWidgets(slug);
    setLinks(saved.links);
    setFaq(saved.faq);
  }, [slug]);

  // Load custom widget settings from DB
  useEffect(() => {
    const workspaceId = workspace?.id;
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
        console.warn("[CustomizePage] Failed to fetch widget settings:", err)
      );
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, slug]);

  // Load naming prefix & store integration details
  useEffect(() => {
    if (!workspace?.id) return;
    if (workspace.collection_prefix) {
      setNamingPrefix(workspace.collection_prefix);
    }

    let cancelled = false;
    async function loadPrefix() {
      try {
        const res = await fetch(
          `/api/workspaces/naming-prefix?workspaceId=${encodeURIComponent(workspace!.id)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            if (data.prefix) setNamingPrefix(data.prefix);
            if (data.storeUrl) setStoreUrl(data.storeUrl);
            if (data.provider) setStoreProvider(data.provider);
          }
        }
      } catch (err) {
        console.warn("[CustomizePage] Failed to fetch naming prefix:", err);
      }
    }
    loadPrefix();
    return () => {
      cancelled = true;
    };
  }, [workspace?.id, workspace?.collection_prefix]);

  const handleSaveSettings = async () => {
    if (!workspace?.id || !links || !faq) return;
    setSavingSettings(true);
    try {
      await saveWidgetSettings(workspace.id, slug, { links, faq });
      toast.success("Widget styles saved! Live store will update automatically.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save widget settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSavePrefix = async () => {
    if (!workspace?.id) return;
    setSavingPrefix(true);
    try {
      const res = await fetch("/api/workspaces/naming-prefix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          prefix: namingPrefix,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save naming prefix");
      setNamingPrefix(data.prefix || "AI");
      toast.success("Naming prefix saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save naming prefix");
    } finally {
      setSavingPrefix(false);
    }
  };

  const exampleCollectionUrl = useMemo(() => {
    const cleanPrefix = (namingPrefix || "AI").trim();
    const slugifiedPrefix = cleanPrefix
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    let base = (storeUrl || "").trim().replace(/\/+$/, "");
    if (!base) {
      base = "https://your-store.myshopify.com";
    } else if (!base.startsWith("http://") && !base.startsWith("https://")) {
      base = `https://${base}`;
    }

    const isWoo = storeProvider === "woocommerce" || storeProvider === "wordpress";
    const pathPart = isWoo ? "product-category" : "collections";
    const handlePart = slugifiedPrefix
      ? `${slugifiedPrefix}-linen-beach-dresses`
      : "linen-beach-dresses";

    return `${base}/${pathPart}/${handlePart}`;
  }, [namingPrefix, storeUrl, storeProvider]);

  const style = kind === "links" ? links : faq;
  const setStyle = kind === "links" ? setLinks : setFaq;
  const templates = kind === "links" ? LINK_TEMPLATES : FAQ_TEMPLATES;

  if (!style) {
    return (
      <div className="autommerce-dashboard flex flex-1 items-center justify-center text-sm text-muted-foreground [font-family:var(--brand-font)]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#6B358D] dark:text-[#F76D01]" />
        Loading…
      </div>
    );
  }

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1500px] px-5 py-7 sm:px-7 lg:px-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                  <Paintbrush className="h-4 w-4" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                  Storefront widgets
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
                Widgets styled,
                <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                  matched to your brand.
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                Style how FAQ and internal links look on collection pages, then publish changes to your live store instantly.
              </p>
            </div>
            <Button
              onClick={handleSaveSettings}
              disabled={savingSettings || !links || !faq}
              size="sm"
              className="h-9 gap-2 rounded-xl bg-[#400095] px-4 text-[10px] text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            >
              {savingSettings ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save Changes
            </Button>
          </motion.div>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-5 p-5 sm:p-7 lg:p-10">
      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto">
          <div
            role="tablist"
            className="grid grid-cols-2 rounded-xl border border-border/60 bg-card p-1 shadow-sm"
          >
            {(
              [
                ["faq", "FAQ"],
                ["links", "Internal links"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={kind === id}
                onClick={() => setKind(id)}
                className={cn(
                  "rounded-lg px-2 py-2 text-xs font-semibold transition-colors",
                  kind === id
                    ? "bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-black tracking-tight">Templates</h2>
            <div className="grid grid-cols-1 gap-2">
              {templates.map((template) => {
                const active = style.template === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() =>
                      setStyle((prev) =>
                        prev ? { ...prev, template: template.id } : prev
                      )
                    }
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-[#400095]/40 bg-[#400095]/5 shadow-xs dark:border-[#F76D01]/40 dark:bg-[#F76D01]/5"
                        : "border-border/70 hover:bg-muted/40"
                    )}
                  >
                    <p className="text-xs font-semibold">{template.name}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
                      {template.blurb}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <h2 className="text-sm font-black tracking-tight">Basics & Style</h2>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Heading</Label>
              <Input
                value={style.heading}
                onChange={(e) =>
                  setStyle((prev) =>
                    prev ? { ...prev, heading: e.target.value } : prev
                  )
                }
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Font Family</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setStyle((prev) =>
                        prev ? { ...prev, font: option.id as FontChoice } : prev
                      )
                    }
                    className={cn(
                      "rounded-lg border py-1.5 px-2 text-[11px] font-medium text-center truncate",
                      style.font === option.id
                        ? "border-[#400095]/40 bg-[#400095]/10 text-[#400095] font-semibold dark:border-[#F76D01]/40 dark:bg-[#F76D01]/10 dark:text-[#F76D01]"
                        : "border-border/70 text-muted-foreground hover:text-foreground"
                    )}
                    style={{ fontFamily: option.stack }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Size</Label>
              <div className="flex gap-1">
                {(
                  [
                    ["default", "Default"],
                    ["sm", "SM"],
                    ["md", "MD"],
                    ["lg", "LG"],
                  ] as const
                ).map(([sizeId, label]) => (
                  <button
                    key={sizeId}
                    type="button"
                    onClick={() =>
                      setStyle((prev) =>
                        prev ? { ...prev, size: sizeId as SizeChoice } : prev
                      )
                    }
                    className={cn(
                      "flex-1 rounded-lg border py-1.5 text-[11px] font-medium uppercase text-center",
                      style.size === sizeId
                        ? "border-[#400095]/40 bg-[#400095]/10 text-[#400095] font-semibold dark:border-[#F76D01]/40 dark:bg-[#F76D01]/10 dark:text-[#F76D01]"
                        : "border-border/70 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ColorField
                label="Heading"
                value={style.headingColor}
                onChange={(headingColor) =>
                  setStyle((prev) => (prev ? { ...prev, headingColor } : prev))
                }
              />
              <ColorField
                label="Text"
                value={style.textColor}
                onChange={(textColor) =>
                  setStyle((prev) => (prev ? { ...prev, textColor } : prev))
                }
              />
              <ColorField
                label="Accent"
                value={style.accentColor}
                onChange={(accentColor) =>
                  setStyle((prev) => (prev ? { ...prev, accentColor } : prev))
                }
              />
              <ColorField
                label="Background"
                value={style.backgroundColor}
                onChange={(backgroundColor) =>
                  setStyle((prev) =>
                    prev ? { ...prev, backgroundColor } : prev
                  )
                }
              />
            </div>

            <div className="pt-2">
              <Button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="w-full gap-2 rounded-xl bg-[#400095] text-white shadow-xs hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                size="sm"
              >
                {savingSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Changes
              </Button>
            </div>
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          <div className="overflow-hidden rounded-[24px] border border-border/60 bg-card shadow-[0_15px_50px_rgba(15,23,42,.05)]">
            <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
            <div className="bg-gradient-to-br from-[#400095]/[0.04] to-[#F76D01]/[0.04] p-4 sm:p-5">
            <p className="mb-3 text-[9px] font-bold uppercase tracking-[.16em] text-[#6B358D] dark:text-[#C8A8D2]">
              Collection page · {kind === "faq" ? "FAQ" : "Internal links"}
            </p>
            <div className="rounded-xl border border-border/50 bg-background p-4 shadow-sm">
              {links && faq ? (
                <CollectionPagePreview
                  title="Android Tablets with Pen Support"
                  description="Unlock your creativity and boost productivity with our selection of tablets with pen support."
                  productCount={42}
                  faqStyle={faq}
                  linksStyle={links}
                  focus={kind}
                />
              ) : null}
            </div>
            </div>
          </div>

          <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <div>
              <h2 className="text-sm font-black tracking-tight">HTML snippet</h2>
              <p className="text-[11px] text-muted-foreground">
                {kind === "faq"
                  ? "Place this above the product grid on the collection page."
                  : "Place this below the product grid on the collection page."}
              </p>
            </div>
            {kind === "faq" ? (
              <SnippetBlock
                label="FAQ"
                value={faqSnippet("{{ collection.handle }}", appOrigin)}
              />
            ) : (
              <SnippetBlock
                label="Internal links"
                value={linksSnippet("{{ collection.handle }}", appOrigin)}
              />
            )}
          </section>
        </div>
      </div>

      {/* Collection naming prefix & URL structure section */}
      <section className="space-y-3 rounded-2xl border border-[#6B358D]/20 bg-gradient-to-br from-[#400095]/[0.06] to-[#F76D01]/[0.04] p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[.16em] text-[#6B358D] dark:text-[#C8A8D2]">
              <Sparkles className="h-3 w-3" /> Naming
            </div>
            <h2 className="text-sm font-black tracking-tight">
              Collection Naming Prefix
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Customize the prefix automatically prepended to newly pushed AI collections
              in your store.
            </p>
          </div>
          <Button
            onClick={handleSavePrefix}
            disabled={savingPrefix}
            size="sm"
            className="self-start sm:self-auto gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
          >
            {savingPrefix ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save Prefix
          </Button>
        </div>

        <div className="max-w-xs space-y-1.5 pt-1">
          <Label className="text-xs text-muted-foreground">Prefix keyword</Label>
          <Input
            value={namingPrefix}
            onChange={(e) => setNamingPrefix(e.target.value)}
            placeholder="e.g. AI, Smart, Trend"
            className="h-9 rounded-xl bg-background text-xs font-medium"
          />
        </div>

        <div className="mt-4 rounded-xl border border-border/60 bg-background/80 p-3.5 space-y-2">
          <p className="text-[11px] font-semibold text-foreground">
            Live URL Structure Preview
          </p>
          <div className="flex items-center gap-2 text-xs font-mono bg-muted/50 rounded-lg px-3 py-2 border border-border/50 break-all select-all">
            <span className="text-muted-foreground">URL:</span>
            <span className="font-medium text-[#400095] dark:text-[#F76D01]">{exampleCollectionUrl}</span>
          </div>
        </div>
      </section>
      </main>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background p-1">
        <input
          type="color"
          value={value.startsWith("#") && value.length === 7 ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent font-mono text-[11px] outline-none"
        />
      </div>
    </div>
  );
}

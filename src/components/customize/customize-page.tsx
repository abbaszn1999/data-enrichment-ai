"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Copy, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useWorkspaceContext } from "@/app/(dashboard)/w/[workspaceSlug]/layout";
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
import { CollectionPagePreview } from "./collection-page-preview";

export function CustomizePage() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params.workspaceSlug ?? "";
  const { workspace } = useWorkspaceContext();

  const [kind, setKind] = useState<WidgetKind>("faq");
  const [links, setLinks] = useState<WidgetStyle | null>(null);
  const [faq, setFaq] = useState<WidgetStyle | null>(null);
  const [copied, setCopied] = useState<"faq" | "links" | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Collection naming prefix settings
  const [namingPrefix, setNamingPrefix] = useState("AI");
  const [storeUrl, setStoreUrl] = useState("");
  const [storeProvider, setStoreProvider] = useState<string | null>(null);
  const [savingPrefix, setSavingPrefix] = useState(false);
  const [appOrigin, setAppOrigin] = useState("https://data-enrichment-ai.onrender.com");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const origin = window.location.origin;
      if (origin && !origin.includes("localhost") && !origin.includes("127.0.0.1")) {
        setAppOrigin(origin);
      } else {
        setAppOrigin("https://data-enrichment-ai.onrender.com");
      }
    }
  }, []);

  // Initial load from localStorage
  useEffect(() => {
    const saved = loadCustomizeWidgets(slug);
    setLinks(saved.links);
    setFaq(saved.faq);
  }, [slug]);

  // Load custom widget settings from DB
  useEffect(() => {
    if (!workspace?.id) return;
    let cancelled = false;
    async function loadSettings() {
      try {
        const res = await fetch(
          `/api/workspaces/widget-settings?workspaceId=${encodeURIComponent(workspace!.id)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.settings) {
            setLinks(data.settings.links);
            setFaq(data.settings.faq);
            saveCustomizeWidgets(slug, data.settings);
          }
        }
      } catch (err) {
        console.warn("[CustomizePage] Failed to fetch widget settings:", err);
      }
    }
    loadSettings();
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
      const res = await fetch("/api/workspaces/widget-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          settings: { links, faq },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save widget settings");
      saveCustomizeWidgets(slug, { links, faq });
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

  const copySnippet = async (which: "faq" | "links", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      toast.success(
        which === "faq" ? "FAQ snippet copied" : "Links snippet copied"
      );
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Couldn’t copy");
    }
  };

  if (!style) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Customize Widgets</h1>
          <p className="max-w-2xl text-xs text-muted-foreground leading-relaxed">
            Style how FAQ and internal links look on collection pages. Choose templates,
            fonts, sizes and colors, then click Save to apply immediately on your live store.
          </p>
        </div>
        <Button
          onClick={handleSaveSettings}
          disabled={savingSettings || !links || !faq}
          size="sm"
          className="gap-2 shadow-sm font-medium"
        >
          {savingSettings ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Changes
        </Button>
      </div>

      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto">
          <div
            role="tablist"
            className="grid grid-cols-2 rounded-xl border border-border/70 p-1"
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
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold tracking-tight">Templates</h2>
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
                        ? "border-primary/40 bg-primary/5 shadow-xs"
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

          <section className="space-y-3 rounded-xl border border-border/70 p-3">
            <h2 className="text-sm font-semibold tracking-tight">Basics & Style</h2>

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
                        ? "border-primary/40 bg-primary/10 text-primary font-semibold"
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
                        ? "border-primary/40 bg-primary/10 text-primary font-semibold"
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
                className="w-full gap-2 shadow-xs"
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
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 sm:p-5">
            <p className="mb-3 text-[10px] uppercase tracking-wide text-muted-foreground">
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

          <section className="space-y-3 rounded-xl border border-border/70 p-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">HTML snippet</h2>
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
                copied={copied === "faq"}
                onCopy={() =>
                  copySnippet("faq", faqSnippet("{{ collection.handle }}", appOrigin))
                }
              />
            ) : (
              <SnippetBlock
                label="Internal links"
                value={linksSnippet("{{ collection.handle }}", appOrigin)}
                copied={copied === "links"}
                onCopy={() =>
                  copySnippet("links", linksSnippet("{{ collection.handle }}", appOrigin))
                }
              />
            )}
          </section>
        </div>
      </div>

      {/* Collection naming prefix & URL structure section */}
      <section className="space-y-3 rounded-2xl border border-border/70 bg-muted/10 p-5 sm:p-6 mt-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
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
            className="self-start sm:self-auto gap-2"
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
            className="h-9 text-xs font-medium"
          />
        </div>

        <div className="mt-4 rounded-xl border border-border/60 bg-background/80 p-3.5 space-y-2">
          <p className="text-[11px] font-semibold text-foreground">
            Live URL Structure Preview
          </p>
          <div className="flex items-center gap-2 text-xs font-mono bg-muted/50 rounded-lg px-3 py-2 border border-border/50 break-all select-all">
            <span className="text-muted-foreground">URL:</span>
            <span className="text-primary font-medium">{exampleCollectionUrl}</span>
          </div>
        </div>
      </section>
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

function SnippetBlock({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className="h-6 gap-1 px-2 text-[11px]"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border/70 bg-background p-3 font-mono text-[11px] text-foreground leading-relaxed">
        {value}
      </pre>
    </div>
  );
}

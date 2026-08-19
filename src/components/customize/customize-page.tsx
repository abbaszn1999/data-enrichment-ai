"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";
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

  useEffect(() => {
    const saved = loadCustomizeWidgets(slug);
    setLinks(saved.links);
    setFaq(saved.faq);
  }, [slug]);

  useEffect(() => {
    if (!links || !faq) return;
    saveCustomizeWidgets(slug, { links, faq });
  }, [slug, links, faq]);

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
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Customize</h1>
        <p className="max-w-2xl text-xs text-muted-foreground leading-relaxed">
          Style how FAQ and internal links look on collection pages. FAQ sits
          above the product grid, related links below it. Copy the HTML snippet
          for each widget when you place them on the store.
        </p>
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
                        ? "border-primary/40 bg-primary/5"
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
            <h2 className="text-sm font-semibold tracking-tight">Basics</h2>
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
              <Label className="text-[11px] text-muted-foreground">Font</Label>
              <div className="flex gap-1">
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setStyle((prev) =>
                        prev ? { ...prev, font: option.id } : prev
                      )
                    }
                    className={cn(
                      "flex-1 rounded-lg border py-1.5 text-[11px] font-medium",
                      style.font === option.id
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/70 text-muted-foreground"
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
                {(["sm", "md", "lg"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() =>
                      setStyle((prev) => (prev ? { ...prev, size } : prev))
                    }
                    className={cn(
                      "flex-1 rounded-lg border py-1.5 text-[11px] font-medium uppercase",
                      style.size === size
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/70 text-muted-foreground"
                    )}
                  >
                    {size}
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
                  title="Polarized Sunglasses"
                  description="Polarized Sunglasses for every budget and style. This collection groups products your catalog already carries."
                  productCount={4200}
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

      {/* ========================================================================= */}
      {/* COLLECTION NAMING PREFIX SETTINGS                                         */}
      {/* ========================================================================= */}
      <section className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 space-y-4 shadow-xs">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Collection naming prefix
          </h2>
        </div>

        <div className="max-w-2xl space-y-2">
          <Input
            value={namingPrefix}
            onChange={(e) => setNamingPrefix(e.target.value)}
            placeholder="AI"
            className="h-9 text-xs font-medium"
          />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Prepended to the title of every collection Push Live creates, always followed by &quot; - &quot;, so AI-generated collections stay visually distinct from ones you made by hand. Defaults to &quot;AI&quot; - it can never be turned off, only changed.
          </p>
        </div>

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={savingPrefix}
            onClick={handleSavePrefix}
            className="h-8 text-xs font-semibold gap-1.5"
          >
            {savingPrefix ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            <span>Save Naming Prefix</span>
          </Button>
        </div>

        <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5 space-y-1">
          <p className="text-xs font-semibold text-foreground">
            Example collection URL
          </p>
          <p className="text-xs font-mono text-muted-foreground break-all">
            {exampleCollectionUrl}
          </p>
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
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 rounded-lg border border-border/70 px-2 py-1">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label={label}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[11px] uppercase outline-none"
        />
      </span>
    </label>
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
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-[11px]"
          onClick={onCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  );
}

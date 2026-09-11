"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseAnalyticsRuleConfig } from "@/lib/analytics/rules";
import type { AnalyticsPageType, AnalyticsRuleConfig } from "@/lib/analytics/types";
import { AlertCircle, Plus, X } from "lucide-react";

const COPY: Record<
  AnalyticsPageType,
  { title: string; description: string; simple: string[]; regex: string[] }
> = {
  plp: {
    title: "Configure PLP page rules",
    description:
      "Define URL patterns that identify Product Listing Pages (collections, categories, shop indexes).",
    simple: ["/collections/", "/category/", "/shop/"],
    regex: ["^/collections/[^/]+$", "/category/.*", "^/shop/[a-z-]+/$"],
  },
  products: {
    title: "Configure product page rules",
    description: "Define URL patterns that identify Product Pages in your analytics data.",
    simple: ["/product/", "/p/", "/item/", "/products/"],
    regex: ["^/product/[^/]+$", "/p/.*", "/item/[a-z0-9-]+$", "^/products/[^/]+/$"],
  },
};

function ChoiceRow({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-xl border bg-background p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`h-8 rounded-lg px-3 text-xs font-semibold ${
            value === option.id
              ? "bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/12 dark:text-[#F76D01]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const EMPTY_RULE_CONFIG: AnalyticsRuleConfig = {
  filterMode: "include",
  patternType: "simple",
  isActive: true,
  patterns: { logic: "OR", rules: [{ value: "", enabled: true }] },
};

export function AnalyticsRulesDialog({
  open,
  onOpenChange,
  pageType,
  initialConfig,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageType: AnalyticsPageType;
  initialConfig?: AnalyticsRuleConfig | null;
  onSave: (config: AnalyticsRuleConfig) => Promise<void>;
}) {
  const copy = COPY[pageType];
  const [config, setConfig] = useState<AnalyticsRuleConfig>(EMPTY_RULE_CONFIG);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setConfig(
      initialConfig
        ? {
            filterMode: initialConfig.filterMode,
            patternType: initialConfig.patternType,
            isActive: initialConfig.isActive,
            patterns: {
              logic: initialConfig.patterns.logic,
              rules: initialConfig.patterns.rules.length
                ? initialConfig.patterns.rules.map((rule) => ({ ...rule }))
                : [{ value: "", enabled: true }],
            },
          }
        : {
            filterMode: "include",
            patternType: "simple",
            isActive: true,
            patterns: { logic: "OR", rules: [{ value: "", enabled: true }] },
          }
    );
    setErrors([]);
  }, [initialConfig, open]);

  const examples = config.patternType === "simple" ? copy.simple : copy.regex;

  const handleSave = async () => {
    const parsed = parseAnalyticsRuleConfig({
      ...config,
      patterns: {
        ...config.patterns,
        rules: config.patterns.rules.filter((rule) => rule.value.trim()),
      },
    });
    if (!parsed.config) {
      setErrors(parsed.errors);
      return;
    }

    setSaving(true);
    setErrors([]);
    try {
      await onSave(parsed.config);
      onOpenChange(false);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Failed to save rules"]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div className="space-y-2">
            <Label>Filter mode</Label>
            <ChoiceRow
              value={config.filterMode}
              onChange={(value) =>
                setConfig({ ...config, filterMode: value as AnalyticsRuleConfig["filterMode"] })
              }
              options={[
                { id: "include", label: "Include matching pages" },
                { id: "exclude", label: "Exclude matching pages" },
              ]}
            />
          </div>

          <div className="space-y-2">
            <Label>Pattern type</Label>
            <ChoiceRow
              value={config.patternType}
              onChange={(value) =>
                setConfig({ ...config, patternType: value as AnalyticsRuleConfig["patternType"] })
              }
              options={[
                { id: "simple", label: "Simple text" },
                { id: "regex", label: "Regex" },
              ]}
            />
            <p className="text-[11px] text-muted-foreground">
              Simple matches text inside the URL, case-insensitive. Regex is for exact path shapes.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Logic</Label>
            <ChoiceRow
              value={config.patterns.logic}
              onChange={(value) =>
                setConfig({
                  ...config,
                  patterns: { ...config.patterns, logic: value as "AND" | "OR" },
                })
              }
              options={[
                { id: "OR", label: "Match ANY (OR)" },
                { id: "AND", label: "Match ALL (AND)" },
              ]}
            />
          </div>

          <div className="space-y-2">
            <Label>Patterns</Label>
            <div className="space-y-2">
              {config.patterns.rules.map((pattern, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={pattern.value}
                    onChange={(event) => {
                      const rules = [...config.patterns.rules];
                      rules[index] = { ...rules[index], value: event.target.value };
                      setConfig({ ...config, patterns: { ...config.patterns, rules } });
                    }}
                    placeholder={
                      config.patternType === "simple"
                        ? pageType === "products"
                          ? "e.g. /product/"
                          : "e.g. /collections/"
                        : pageType === "products"
                          ? "e.g. ^/product/[^/]+$"
                          : "e.g. ^/collections/[^/]+$"
                    }
                    className="font-mono text-xs"
                  />
                  {config.patterns.rules.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() =>
                        setConfig({
                          ...config,
                          patterns: {
                            ...config.patterns,
                            rules: config.patterns.rules.filter((_, i) => i !== index),
                          },
                        })
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                setConfig({
                  ...config,
                  patterns: {
                    ...config.patterns,
                    rules: [...config.patterns.rules, { value: "", enabled: true }],
                  },
                })
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add pattern
            </Button>
          </div>

          <details className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Example patterns
            </summary>
            <div className="mt-2 space-y-1 font-mono text-xs text-foreground">
              {examples.map((example) => (
                <div key={example}>{example}</div>
              ))}
            </div>
          </details>

          {errors.length > 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <ul className="space-y-1">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving..." : "Save rules"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

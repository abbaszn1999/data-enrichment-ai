"use client";

import { Pin, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIMITS } from "@/lib/google-ads/constants";
import { rateAdStrength } from "@/lib/google-ads/mutations";
import { CATALOG_SAMPLE } from "@/lib/google-ads/mock-data";
import type { AdText, PinPosition } from "@/lib/google-ads/types";
import { SearchAdPreview } from "./ga-ad-preview";
import { AdStrengthMeter, Field, LimitedInput } from "./ga-ui";

export type RsaDraft = {
  headlines: AdText[];
  descriptions: AdText[];
  finalUrl: string;
  path1: string;
  path2: string;
};

export function emptyRsa(finalUrl = ""): RsaDraft {
  return { headlines: [{ text: "" }, { text: "" }, { text: "" }], descriptions: [{ text: "" }, { text: "" }], finalUrl, path1: "", path2: "" };
}

const HEADLINE_PINS: PinPosition[] = ["HEADLINE_1", "HEADLINE_2", "HEADLINE_3"];
const DESCRIPTION_PINS: PinPosition[] = ["DESCRIPTION_1", "DESCRIPTION_2"];

function TextList({
  label,
  items,
  max,
  min,
  limit,
  pins,
  onChange,
  multiline,
}: {
  label: string;
  items: AdText[];
  max: number;
  min: number;
  limit: number;
  pins: PinPosition[];
  onChange: (items: AdText[]) => void;
  multiline?: boolean;
}) {
  const filled = items.filter((i) => i.text.trim()).length;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold">{label}</p>
        <span className={cn("text-[10px]", filled < min ? "text-amber-600" : "text-muted-foreground")}>
          {filled}/{max} {filled < min && `· at least ${min}`}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <LimitedInput className="flex-1" value={item.text} max={limit} multiline={multiline} placeholder={`${label.slice(0, -1)} ${i + 1}`} onChange={(text) => onChange(items.map((x, j) => (j === i ? { ...x, text } : x)))} />
            <select
              value={item.pinned ?? ""}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, pinned: (e.target.value || undefined) as PinPosition | undefined } : x)))}
              title="Pin to a position"
              className={cn("h-9 w-14 shrink-0 rounded-md border bg-background px-1 text-[10px]", item.pinned ? "border-[#400095] text-[#400095] dark:border-violet-400 dark:text-violet-300" : "border-input text-muted-foreground")}
            >
              <option value="">Pin</option>
              {pins.map((p) => (
                <option key={p} value={p}>
                  {p.endsWith("1") ? "1st" : p.endsWith("2") ? "2nd" : "3rd"}
                </option>
              ))}
            </select>
            {items.length > min && (
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mt-2 rounded p-0.5 text-muted-foreground hover:text-red-600" aria-label="Remove">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {items.length < max && (
        <button type="button" onClick={() => onChange([...items, { text: "" }])} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#400095] hover:underline dark:text-violet-300">
          <Plus className="h-3 w-3" /> Add {label.slice(0, -1).toLowerCase()}
        </button>
      )}
    </div>
  );
}

/** Headline ideas pulled from catalog products (stands in for AI generation). */
function catalogSuggestions(existing: AdText[]): string[] {
  const have = new Set(existing.map((h) => h.text.toLowerCase()));
  return CATALOG_SAMPLE.flatMap((p) => [p.title, ...p.features, `From $${p.price}`])
    .filter((s) => s.length <= LIMITS.headline && !have.has(s.toLowerCase()))
    .slice(0, 8);
}

export function RsaEditor({ value, onChange, keywords = [] }: { value: RsaDraft; onChange: (v: RsaDraft) => void; keywords?: string[] }) {
  const headlines = value.headlines.map((h) => h.text);
  const descriptions = value.descriptions.map((d) => d.text);
  const strength = rateAdStrength(headlines, descriptions, keywords);
  const filledH = headlines.filter((h) => h.trim());
  const tips = [
    filledH.length < 8 && `Add ${8 - filledH.length} more headlines (aim for 8–15).`,
    new Set(filledH.map((h) => h.toLowerCase())).size < filledH.length && "Some headlines repeat. Make each one unique.",
    keywords.length > 0 && !filledH.some((h) => keywords.some((k) => h.toLowerCase().includes(k.split(" ")[0]))) && "Include your keywords in at least 2 headlines.",
    value.headlines.filter((h) => h.pinned).length > 2 && "Pinning many headlines limits combinations and lowers ad strength.",
    descriptions.filter((d) => d.trim()).length < 4 && "Use all 4 descriptions.",
  ].filter(Boolean) as string[];
  const ideas = catalogSuggestions(value.headlines);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Field label="Final URL" hint="Where people land after clicking.">
          <input
            value={value.finalUrl}
            onChange={(e) => onChange({ ...value, finalUrl: e.target.value })}
            placeholder="https://"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Display path 1">
            <LimitedInput value={value.path1} max={LIMITS.path} onChange={(path1) => onChange({ ...value, path1 })} />
          </Field>
          <Field label="Display path 2">
            <LimitedInput value={value.path2} max={LIMITS.path} onChange={(path2) => onChange({ ...value, path2 })} />
          </Field>
        </div>
        <TextList label="Headlines" items={value.headlines} max={LIMITS.rsaHeadlinesMax} min={LIMITS.rsaHeadlinesMin} limit={LIMITS.headline} pins={HEADLINE_PINS} onChange={(h) => onChange({ ...value, headlines: h })} />
        {ideas.length > 0 && value.headlines.length < LIMITS.rsaHeadlinesMax && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <Sparkles className="h-3 w-3 text-[#F76D01]" /> Ideas from your catalog
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ideas.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => {
                    const empty = value.headlines.findIndex((h) => !h.text.trim());
                    const next = empty >= 0 ? value.headlines.map((h, i) => (i === empty ? { text: idea } : h)) : [...value.headlines, { text: idea }];
                    onChange({ ...value, headlines: next.slice(0, LIMITS.rsaHeadlinesMax) });
                  }}
                  className="rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] hover:border-[#400095]/50 hover:bg-[#400095]/[0.04]"
                >
                  + {idea}
                </button>
              ))}
            </div>
          </div>
        )}
        <TextList label="Descriptions" items={value.descriptions} max={LIMITS.rsaDescriptionsMax} min={LIMITS.rsaDescriptionsMin} limit={LIMITS.description} pins={DESCRIPTION_PINS} multiline onChange={(d) => onChange({ ...value, descriptions: d })} />
      </div>
      <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
        <div className="rounded-xl border border-border/60 p-3">
          <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Ad strength</p>
          <AdStrengthMeter strength={strength} />
          {tips.length > 0 && (
            <ul className="mt-2 space-y-1">
              {tips.map((t) => (
                <li key={t} className="flex gap-1.5 text-[11px] text-muted-foreground">
                  <Pin className="mt-0.5 h-3 w-3 shrink-0 rotate-45" /> {t}
                </li>
              ))}
            </ul>
          )}
        </div>
        <SearchAdPreview headlines={value.headlines} descriptions={value.descriptions} finalUrl={value.finalUrl || "https://example.com"} path1={value.path1} path2={value.path2} />
      </div>
    </div>
  );
}

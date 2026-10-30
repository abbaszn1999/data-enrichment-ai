"use client";

import { useMemo, useState } from "react";
import { Monitor, RefreshCw, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdText, Asset } from "@/lib/google-ads/types";

function pickCombo(headlines: AdText[], descriptions: AdText[], seed: number) {
  const valid = (x: AdText) => x.text.trim().length > 0;
  const hs = headlines.filter(valid);
  const ds = descriptions.filter(valid);
  const slot = (pin: AdText["pinned"], pool: AdText[], offset: number) =>
    pool.find((h) => h.pinned === pin) ?? pool.filter((h) => !h.pinned)[(seed + offset) % Math.max(1, pool.filter((h) => !h.pinned).length)];
  const h1 = slot("HEADLINE_1", hs, 0);
  const h2 = slot("HEADLINE_2", hs.filter((h) => h !== h1), 1);
  const h3 = slot("HEADLINE_3", hs.filter((h) => h !== h1 && h !== h2), 2);
  const d1 = slot("DESCRIPTION_1", ds, 0);
  const d2 = slot("DESCRIPTION_2", ds.filter((d) => d !== d1), 1);
  return { headlines: [h1, h2, h3].filter(Boolean).map((h) => h!.text), descriptions: [d1, d2].filter(Boolean).map((d) => d!.text) };
}

/** Google search result mock for a responsive search ad. */
export function SearchAdPreview({
  headlines,
  descriptions,
  finalUrl,
  path1,
  path2,
  sitelinks = [],
  callouts = [],
  compact,
}: {
  headlines: AdText[];
  descriptions: AdText[];
  finalUrl: string;
  path1?: string;
  path2?: string;
  sitelinks?: Asset[];
  callouts?: Asset[];
  compact?: boolean;
}) {
  const [seed, setSeed] = useState(0);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const combo = useMemo(() => pickCombo(headlines, descriptions, seed), [headlines, descriptions, seed]);
  const domain = finalUrl.replace(/^https?:\/\//, "").split("/")[0] || "example.com";
  const display = [domain, path1, path2].filter(Boolean).join(" › ");

  return (
    <div className={cn("rounded-xl border border-border/60 bg-white text-left text-[#202124] dark:bg-zinc-900 dark:text-zinc-100", compact ? "p-3" : "p-4")}>
      {!compact && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Preview</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setDevice("mobile")} className={cn("rounded p-1", device === "mobile" ? "bg-muted" : "text-muted-foreground")} aria-label="Mobile preview">
              <Smartphone className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setDevice("desktop")} className={cn("rounded p-1", device === "desktop" ? "bg-muted" : "text-muted-foreground")} aria-label="Desktop preview">
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setSeed((s) => s + 1)} className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted" title="Show another combination">
              <RefreshCw className="h-3 w-3" /> Next
            </button>
          </div>
        </div>
      )}
      <div className={cn(device === "mobile" && !compact && "mx-auto max-w-[340px] rounded-2xl border border-border/60 p-3 shadow-sm")}>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {domain[0]?.toUpperCase()}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-[11px] font-medium">
              <span className="font-bold">Sponsored</span>
            </p>
            <p className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">{display}</p>
          </div>
        </div>
        <p className={cn("mt-1.5 font-normal leading-snug text-[#1a0dab] dark:text-[#8ab4f8]", compact ? "text-sm" : device === "desktop" ? "text-lg" : "text-base")}>
          {combo.headlines.join(" | ") || "Your headline | Another headline"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[#4d5156] dark:text-zinc-400">{combo.descriptions.join(" ") || "Your description appears here."}</p>
        {callouts.length > 0 && <p className="mt-1 text-xs text-[#4d5156] dark:text-zinc-400">{callouts.slice(0, 4).map((c) => c.title).join(" · ")}</p>}
        {sitelinks.length > 0 && !compact && (
          <div className={cn("mt-2 grid gap-x-4 gap-y-1", device === "desktop" ? "grid-cols-2" : "grid-cols-1")}>
            {sitelinks.slice(0, 4).map((s) => (
              <div key={s.id} className={cn(device === "mobile" && "border-t border-border/50 pt-1")}>
                <p className="text-xs text-[#1a0dab] dark:text-[#8ab4f8]">{s.title}</p>
                {device === "desktop" && s.lines?.[0] && <p className="text-[11px] text-[#4d5156] dark:text-zinc-400">{s.lines[0]}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

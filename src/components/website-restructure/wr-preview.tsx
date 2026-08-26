"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Code2, Copy, Download, Eye, Laptop, ListTree, RefreshCw, Smartphone, Tablet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { injectLogoSrc } from "@/lib/website-restructure/export";
import type { WrBuildResult } from "@/lib/website-restructure/types";

type PreviewSize = "desktop" | "tablet" | "mobile";
type ViewMode = "live" | "code";
type CodeTab = "html" | "css" | "js";

const SIZE_WIDTH: Record<PreviewSize, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

// Even with href="#" everywhere (per the skill instructions), a click still
// triggers a same-document navigation. Because this doc is loaded via
// `srcDoc`, its relative-URL base is inherited from the *parent* page
// (a browser quirk), so that "#" click actually tries to navigate the
// sandboxed iframe to the real app URL — landing on our own login page,
// since the sandboxed frame (no allow-same-origin) carries no session. This
// capture-phase listener kills the default action of every click on an
// anchor before that navigation can happen, regardless of what href the
// agent produced. It never calls stopPropagation, so the header's own
// dropdown/menu click handlers still run normally.
const WR_PREVIEW_NAV_GUARD = `
document.addEventListener("click", function (e) {
  var a = e.target && e.target.closest ? e.target.closest("a") : null;
  if (a) e.preventDefault();
}, true);
`;

// The iframe is a separate document (via `srcDoc`), so the dashboard's own
// dark-mode CSS never reaches it. The generated header sets its own explicit
// colors, but the blank page area below it falls back to the browser's
// default white canvas — which reads as a stray white box against the dark
// dashboard chrome. Baking the current dashboard theme into the body
// background (never into the header's own markup/styles) keeps that blank
// area matching the shell without changing anything the merchant exports.
function buildPreviewDoc(result: WrBuildResult, logoUrl: string | null, isDark: boolean): string {
  const html = injectLogoSrc(result.html, logoUrl);
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<style>body{margin:0;font-family:system-ui,sans-serif;background:${isDark ? "#000000" : "#ffffff"};}${result.css}</style>`,
    "</head><body>",
    html,
    `<script>${result.js}</script>`,
    `<script>${WR_PREVIEW_NAV_GUARD}</script>`,
    "</body></html>",
  ].join("");
}

export type WrVersionSummary = { version: number; createdAt: string; notes: string; instruction?: string };

type WrPreviewProps = {
  result: WrBuildResult | null;
  logoUrl: string | null;
  versions: WrVersionSummary[];
  activeVersion: number;
  onSelectVersion: (version: number) => void;
  downloadUrl: string;
  busy: boolean;
};

export function WrPreview({
  result,
  logoUrl,
  versions,
  activeVersion,
  onSelectVersion,
  downloadUrl,
  busy,
}: WrPreviewProps) {
  const [size, setSize] = useState<PreviewSize>("desktop");
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [codeTab, setCodeTab] = useState<CodeTab>("html");
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  const srcDoc = useMemo(
    () => (result ? buildPreviewDoc(result, logoUrl, isDark) : ""),
    [result, logoUrl, isDark]
  );

  const copyCode = async () => {
    if (!result) return;
    const combined = `<!-- HTML -->\n${result.html}\n\n<!-- CSS -->\n<style>\n${result.css}\n</style>\n\n<!-- JS -->\n<script>\n${result.js}\n</script>`;
    try {
      await navigator.clipboard.writeText(combined);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied — silently ignore, the copy button just won't confirm.
    }
  };

  const openMenu = () => {
    iframeRef.current?.contentWindow?.postMessage({ source: "wr-preview", action: "open-menu" }, "*");
  };

  return (
    <div className="autommerce-dashboard flex h-full min-h-0 w-full flex-col [font-family:var(--brand-font)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5 shrink-0">
        {viewMode === "live" ? (
          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 p-0.5">
            {([
              { key: "desktop", icon: Laptop, label: "Desktop" },
              { key: "tablet", icon: Tablet, label: "Tablet" },
              { key: "mobile", icon: Smartphone, label: "Mobile" },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSize(key)}
                title={label}
                aria-label={label}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  size === key
                    ? "bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 p-0.5">
            {([
              { key: "html", label: "HTML" },
              { key: "css", label: "CSS" },
              { key: "js", label: "JS" },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setCodeTab(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  codeTab === key
                    ? "bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {viewMode === "live" ? (
          <>
            <button
              type="button"
              onClick={openMenu}
              disabled={!result}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <ListTree className="h-3.5 w-3.5" />
              Open menu
            </button>

            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={!result}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 text-muted-foreground hover:text-foreground disabled:opacity-40"
              title="Refresh preview"
              aria-label="Refresh preview"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}

        <div className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 p-0.5">
          {([
            { key: "live", icon: Eye, label: "Live" },
            { key: "code", icon: Code2, label: "Code" },
          ] as const).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setViewMode(key)}
              disabled={!result}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                viewMode === key
                  ? "bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {versions.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Version {activeVersion}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {versions
                  .slice()
                  .sort((a, b) => b.version - a.version)
                  .map((v) => (
                    <DropdownMenuItem
                      key={v.version}
                      onClick={() => onSelectVersion(v.version)}
                      className="flex flex-col items-start gap-0.5 text-xs"
                    >
                      <span className="font-medium">
                        Version {v.version} {v.version === activeVersion ? "· current" : ""}
                      </span>
                      <span className="text-[11px] text-muted-foreground line-clamp-2">{v.notes}</span>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <button
            type="button"
            onClick={copyCode}
            disabled={!result}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy code"}
          </button>

          <a
            href={result ? downloadUrl : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity ${
              result ? "bg-[#400095] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90" : "pointer-events-none bg-[#400095]/40 dark:bg-[#F76D01]/40"
            }`}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </div>
      </div>

      {viewMode === "code" && result ? (
        <div className="flex-1 min-h-0 overflow-auto bg-[#0d1117] p-4">
          <pre className="min-h-full whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-[#0d1117] p-4 font-mono text-xs leading-relaxed text-[#c9d1d9]">
            <code>{result[codeTab]}</code>
          </pre>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto bg-[repeating-conic-gradient(#0000_0_25%,color-mix(in_oklch,var(--muted)_45%,transparent)_0_50%)] bg-[length:16px_16px] p-4">
          {result ? (
            <div
              className="mx-auto h-full max-w-full overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm transition-[width] duration-300"
              style={{ width: SIZE_WIDTH[size] }}
            >
              <iframe
                key={refreshKey}
                ref={iframeRef}
                title="Header preview"
                srcDoc={srcDoc}
                sandbox="allow-scripts"
                className={`h-full min-h-[420px] w-full border-0 ${isDark ? "bg-black" : "bg-white"}`}
              />
            </div>
          ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center text-center text-sm text-muted-foreground">
              {busy ? "Building your header…" : "Your header preview will appear here once it's built."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

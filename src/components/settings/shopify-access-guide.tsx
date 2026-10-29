"use client";

import { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ALL_SHOPIFY_SCOPES, SHOPIFY_TOOL_ACCESS, hasShopifyScope, missingShopifyScopes } from "@/lib/integrations/shopify-access";

/**
 * What each tool needs from the Shopify token. Before a test it is a guide
 * (`grantedScopes` undefined); once the token's scopes are known it marks each
 * tool ready or lists what is missing.
 */
export function ShopifyAccessGuide({
  grantedScopes,
  loading = false,
  onRecheck,
  className,
}: {
  /** undefined: not checked yet. null: Shopify did not say. */
  grantedScopes: readonly string[] | null | undefined;
  loading?: boolean;
  onRecheck?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const checked = Array.isArray(grantedScopes);
  const granted = new Set(grantedScopes ?? []);
  const tools = SHOPIFY_TOOL_ACCESS.map((tool) => ({ tool, missing: checked ? missingShopifyScopes([...granted], tool.scopes) : [] }));
  const ready = tools.filter((t) => t.missing.length === 0).length;
  const allMissing = checked ? missingShopifyScopes([...granted], ALL_SHOPIFY_SCOPES) : [];

  const copy = async (scopes: readonly string[]) => {
    try {
      await navigator.clipboard.writeText(scopes.join(","));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the scopes are on screen to copy by hand.
    }
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-background", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
            <ShieldCheck className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-tight">Access each tool needs</p>
            <p className="text-[11px] text-muted-foreground">
              {checked
                ? allMissing.length
                  ? `${ready} of ${tools.length} tools ready`
                  : "Every tool has the access it needs"
                : grantedScopes === null
                  ? "Shopify did not report this token's scopes"
                  : "Admin API scopes to enable on your Shopify app"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {onRecheck && (
            <Button type="button" variant="ghost" size="sm" onClick={onRecheck} disabled={loading} className="h-7 gap-1.5 px-2 text-[11.5px]">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Recheck
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copy(allMissing.length ? allMissing : ALL_SHOPIFY_SCOPES)}
            className="h-7 gap-1.5 px-2 text-[11.5px]"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : allMissing.length ? "Copy missing scopes" : "Copy all scopes"}
          </Button>
        </div>
      </div>

      <ul className="divide-y">
        {tools.map(({ tool, missing }) => {
          const ok = checked && missing.length === 0;
          return (
            <li key={tool.id} className="flex gap-3 px-4 py-3">
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  !checked ? "bg-muted text-muted-foreground" : ok ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                )}
              >
                {!checked ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="text-[13px] font-semibold">{tool.name}</p>
                  {checked && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                        ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {ok ? "Ready" : `Missing ${missing.length}`}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{tool.summary}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {tool.scopes.map((scope) => {
                    const has = checked && hasShopifyScope(granted, scope);
                    return (
                      <code
                        key={scope}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]",
                          !checked
                            ? "border-border bg-muted/40 text-foreground/80"
                            : has
                              ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                        )}
                      >
                        {checked && (has ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />)}
                        {scope}
                      </code>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t bg-muted/10 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {checked && !allMissing.length ? (
          <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> No changes needed in Shopify.
          </span>
        ) : (
          <>
            In Shopify: <span className="font-medium text-foreground">Settings → Apps → Develop apps → your app → Configuration</span>, enable these
            Admin API scopes, save, then install or update the app.{" "}
            {checked ? "Recheck here when done; if Shopify gives a new token, reconnect with it." : "Use its Admin API access token above."}
            {" "}Tools whose scopes are missing will say so when they run.
          </>
        )}
      </div>
    </div>
  );
}

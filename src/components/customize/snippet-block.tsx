"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { snippetOrigin } from "@/lib/app-origin";

/** The origin never changes while the page is open. */
const noopSubscribe = () => () => {};

function clientOrigin(): string {
  return snippetOrigin(window.location.origin);
}

/**
 * The origin the merchant's theme must call. Read through
 * `useSyncExternalStore` so the server and the first client render agree
 * instead of hydrating with one value and correcting it afterwards.
 */
export function useAppOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    clientOrigin,
    () => snippetOrigin()
  );
}

export function SnippetBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} snippet copied`);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn’t copy");
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copy}
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
      <pre className="overflow-x-auto rounded-lg border border-border/70 bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground">
        {value}
      </pre>
    </div>
  );
}

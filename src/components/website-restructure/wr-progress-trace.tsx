"use client";

import { Check, Loader2 } from "lucide-react";

/**
 * Real progress steps fed by the build/edit NDJSON stream — each entry is a
 * `status` message the server pushed right before starting that unit of work,
 * so the list is honest about what's actually happening (vision → research →
 * generation), not a decorative fixed-duration animation.
 */
export function WrProgressTrace({ steps, done }: { steps: string[]; done: boolean }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-2 rounded-2xl border border-border/60 bg-muted/20 px-3.5 py-3">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const isRunning = isLast && !done;
        return (
          <li key={`${i}-${step}`} className="flex items-center gap-2.5 text-xs">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {isRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#6B358D] dark:text-[#F76D01]" />
              ) : (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              )}
            </span>
            <span className={isRunning ? "text-foreground" : "text-muted-foreground"}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

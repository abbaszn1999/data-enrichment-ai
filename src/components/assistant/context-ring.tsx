"use client";

import type { ContextUsage } from "@/hooks/use-assistant-stream";

const SIZE = 16;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** How full the conversation is; the agent condenses it on its own near the limit. */
export function ContextRing({ usage }: { usage: ContextUsage }) {
  const ratio = Math.min(1, Math.max(0, usage.usedTokens / usage.windowTokens));
  const percent = Math.round(ratio * 100);
  const label = `About ${percent}% of the conversation memory used`;
  return (
    <span role="img" aria-label={label} title={label} className="flex h-9 w-5 shrink-0 items-center justify-center">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-muted-foreground/25" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          className={`transition-[stroke-dashoffset] duration-500 ${ratio >= 0.8 ? "stroke-amber-500" : "stroke-muted-foreground/70"}`}
        />
      </svg>
    </span>
  );
}

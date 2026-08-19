"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Cpu,
  Database,
  Layers,
  Loader2,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface LoaderStep {
  label: string;
  sublabel?: string;
}

export function FuturisticAiLoader({
  title = "Pushing Collections to Storefront…",
  subtitle = "Authorizing wallet transaction and deploying category taxonomy to your store.",
  steps = [
    { label: "Authorizing transaction & deducting wallet funds", sublabel: "Instant balance hold confirmation" },
    { label: "Deploying taxonomy structures & collection handles", sublabel: "Creating smart store collections" },
    { label: "Linking catalog products with AI confidence", sublabel: "Applying semantic threshold associations" },
    { label: "Initializing Stage 6 On-Page SEO Workspace", sublabel: "Preparing copy generation environment" },
  ],
  durationMs = 3200,
  onComplete,
  className,
}: {
  title?: string;
  subtitle?: string;
  steps?: LoaderStep[];
  durationMs?: number;
  onComplete?: () => void;
  className?: string;
}) {
  const [progress, setProgress] = useState(8);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    const startTime = performance.now();
    let frameId: number;

    const tick = () => {
      const elapsed = performance.now() - startTime;
      const rawProgress = Math.min(1, elapsed / durationMs);
      
      // Calculate smoothed progress percentage
      const currentPct = Math.round(8 + rawProgress * 92);
      setProgress(currentPct);

      // Determine active step index based on progress
      const stepFraction = 1 / steps.length;
      const currentStep = Math.min(
        steps.length - 1,
        Math.floor(rawProgress / stepFraction)
      );
      setActiveStepIndex(currentStep);

      if (rawProgress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        if (onComplete) {
          const timeout = setTimeout(() => {
            onComplete();
          }, 300);
          return () => clearTimeout(timeout);
        }
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [durationMs, onComplete, steps.length]);

  return (
    <div
      className={cn(
        "relative flex h-full min-h-[420px] w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card via-card/95 to-background p-6 text-center shadow-xl",
        className
      )}
    >
      {/* Background Animated Ambient Mesh Light */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-gradient-to-tr from-violet-600/20 via-primary/20 to-cyan-400/20 blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/4 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-gradient-to-br from-emerald-500/15 via-teal-500/15 to-indigo-600/15 blur-3xl" />
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />
      </div>

      <div className="relative z-10 flex w-full max-w-lg flex-col items-center gap-6">
        {/* Futuristic Glowing AI Orb */}
        <div className="relative flex items-center justify-center">
          {/* Outer Breathing Rings */}
          <div className="absolute h-28 w-28 rounded-full border border-primary/20 bg-primary/5 animate-ping opacity-30" />
          <div className="absolute h-24 w-24 rounded-full border border-violet-500/30 bg-violet-500/10 animate-pulse" />
          
          {/* Glowing Orb Center */}
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-primary/40 bg-gradient-to-tr from-violet-600 via-primary to-cyan-400 p-0.5 shadow-[0_0_35px_rgba(139,92,246,0.45)]">
            <div className="flex h-full w-full items-center justify-center rounded-full bg-card/90 backdrop-blur-sm">
              <Store className="h-8 w-8 text-primary animate-bounce duration-1000" />
            </div>
          </div>

          {/* Sparkle orbiting accents */}
          <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md shadow-emerald-500/40">
            <Sparkles className="h-3.5 w-3.5 animate-spin duration-3000" />
          </div>
        </div>

        {/* Header Titles */}
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary shadow-xs">
            <Cpu className="h-3.5 w-3.5 animate-pulse" />
            <span>Autommerce Collection Engine</span>
          </div>
          <h3 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
            {title}
          </h3>
          <p className="max-w-md text-xs text-muted-foreground leading-relaxed">
            {subtitle}
          </p>
        </div>

        {/* Shimmer Glowing Progress Bar */}
        <div className="w-full space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-muted-foreground">Deployment Progress</span>
            <span className="font-mono text-primary tabular-nums">{progress}%</span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/60 p-0.5 shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 via-primary to-cyan-400 transition-all duration-300 ease-out shadow-[0_0_12px_rgba(99,102,241,0.6)]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Live Step Progress Beats with Checkmarks */}
        <div className="w-full space-y-2 rounded-xl border border-border/70 bg-card/70 p-3.5 backdrop-blur-md text-left shadow-xs">
          {steps.map((step, idx) => {
            const isFinished = progress >= ((idx + 1) / steps.length) * 100 || idx < activeStepIndex;
            const isCurrent = idx === activeStepIndex && !isFinished;
            const isPending = idx > activeStepIndex;

            return (
              <div
                key={step.label}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-xs transition-all duration-300",
                  isCurrent
                    ? "bg-primary/10 border border-primary/25 shadow-2xs"
                    : isFinished
                    ? "opacity-90"
                    : "opacity-40"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {isFinished ? (
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </div>
                  ) : isCurrent ? (
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </div>
                  ) : (
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <CircleDashed className="h-3.5 w-3.5" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <p
                      className={cn(
                        "font-medium truncate",
                        isFinished
                          ? "text-foreground"
                          : isCurrent
                          ? "text-primary font-semibold"
                          : "text-muted-foreground"
                      )}
                    >
                      {step.label}
                    </p>
                    {step.sublabel ? (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {step.sublabel}
                      </p>
                    ) : null}
                  </div>
                </div>

                {isFinished ? (
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                    Done
                  </span>
                ) : isCurrent ? (
                  <span className="text-[10px] font-semibold text-primary animate-pulse shrink-0">
                    Working…
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

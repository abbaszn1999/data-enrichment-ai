"use client";

import { Check, ChevronDown, Circle, Loader2, Lock, Receipt } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  STAGE_META,
  type MarketResearchStage,
} from "./mock-data";
import { cn } from "@/lib/utils";

export type StageStepStatus = "done" | "running" | "pending" | "locked";

export type StageStep = {
  stage: MarketResearchStage;
  status: StageStepStatus;
  detail: string;
};

export type StageReceipt = {
  id: string;
  stage: MarketResearchStage;
  title: string;
  detail: string;
};

/** Compact "Step X of 3" indicator for the results header. */
export function StageStepper({
  current,
  steps,
}: {
  current: MarketResearchStage;
  steps: StageStep[];
}) {
  const doneCount = steps.filter((s) => s.status === "done").length;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
        Step {current} of 3
      </span>
      <Progress
        value={(doneCount / 3) * 100}
        className="h-1 w-16"
        aria-label={`${doneCount} of 3 stages complete`}
      />
    </div>
  );
}

/**
 * Activity timeline + action receipts — summary first, details behind disclosure.
 * Keeps the chat for conversation and this panel for "what actually happened".
 */
export function RunTimeline({
  steps,
  receipts,
  current,
}: {
  steps: StageStep[];
  receipts: StageReceipt[];
  current: MarketResearchStage;
}) {
  const running = steps.find((s) => s.status === "running");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const summary = running
    ? `Working on Stage ${running.stage} · ${STAGE_META[running.stage].shortLabel}`
    : `Stage ${current} · ${doneCount} of 3 complete`;

  return (
    <details className="group border-b border-border/60 bg-background/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground">
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        ) : (
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        )}
        <span className="truncate">{summary}</span>
        <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
          Activity
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="space-y-3 px-4 pb-3">
        <ol className="space-y-1.5">
          {steps.map((step) => (
            <li key={step.stage} className="flex items-start gap-2">
              <StepIcon status={step.status} />
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[11px] font-medium",
                    step.status === "locked"
                      ? "text-muted-foreground/60"
                      : "text-foreground/90"
                  )}
                >
                  {step.stage}. {STAGE_META[step.stage].label}
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {receipts.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Receipts
            </p>
            {receipts.map((receipt) => (
              <div
                key={receipt.id}
                className="flex items-start gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-2"
              >
                <Receipt className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium truncate">
                    {receipt.title}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    {receipt.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function StepIcon({ status }: { status: StageStepStatus }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <Check className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (status === "running") {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  }
  if (status === "locked") {
    return <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
}

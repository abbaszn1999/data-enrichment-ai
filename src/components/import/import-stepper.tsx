"use client";

import { Check } from "lucide-react";
import type { SessionKind } from "@/types";

export interface ImportStep {
  num: number;
  label: string;
  /** Route segment under /import/[sessionId]; the upload step has no segment. */
  segment: string | null;
}

/**
 * The single source of truth for the import flow's steps, shared by the
 * stepper header and the session overview page so numbering never drifts.
 */
export function getImportSteps(kind: SessionKind = "product"): ImportStep[] {
  return [
    { num: 1, label: "Upload File", segment: null },
    {
      num: 2,
      label: kind === "plp" ? "Match Categories" : "Matching Rules",
      segment: "rules",
    },
    { num: 3, label: "Review Results", segment: "review" },
    {
      num: 4,
      label: kind === "plp" ? "PLP Workspace" : "Enrichment Tool",
      segment: "enrich",
    },
  ];
}

export function ImportStepper({
  currentStep,
  kind = "product",
}: {
  currentStep: number;
  kind?: SessionKind;
}) {
  const steps = getImportSteps(kind);

  return (
    <div className="flex w-full items-center overflow-x-auto py-1">
      {steps.map((step, i) => (
        <div key={step.num} className="flex min-w-fit flex-1 items-center">
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold transition-all ${
              step.num === currentStep
                ? "border-[#400095]/30 bg-[#400095] text-white shadow-[0_6px_18px_rgba(64,0,149,.18)] dark:border-[#F76D01]/30 dark:bg-[#F76D01]"
                : step.num < currentStep
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-border/60 bg-muted/35 text-muted-foreground"
            }`}
          >
            {step.num < currentStep ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="flex h-4 w-4 items-center justify-center rounded-md bg-current/10 text-[9px] font-black">
                {step.num}
              </span>
            )}
            <span className="whitespace-nowrap">{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`mx-2 h-px min-w-5 flex-1 ${step.num < currentStep ? "bg-emerald-400" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

"use client";

import { Check } from "lucide-react";

const STEPS = [
  { num: 1, label: "Upload File" },
  { num: 2, label: "Matching Rules" },
  { num: 3, label: "Review Results" },
  { num: 4, label: "Enrichment Tool" },
];

export function ImportStepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((step, i) => (
        <div key={step.num} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              step.num === currentStep
                ? "bg-primary text-primary-foreground"
                : step.num < currentStep
                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {step.num < currentStep ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="text-[10px] font-bold">{step.num}</span>
            )}
            <span>{step.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-8 h-0.5 ${step.num < currentStep ? "bg-green-400" : "bg-muted"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

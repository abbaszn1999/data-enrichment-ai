"use client";

import { Check, CheckCircle2, Circle, ClipboardList, Hammer, Loader2, MessageSquareText, RotateCcw, X } from "lucide-react";
import type { ModelParam, TodoItem } from "@/lib/store-agent/protocol";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModelOption, Plan } from "./api";
import { Markdown } from "./markdown";
import { ModelPicker } from "./model-picker";

const STATUS: Record<Plan["status"], { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  building: { label: "Building", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  built: { label: "Built", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
};

/**
 * A plan from Plan mode, like Cursor's plan editor: what will be done, the
 * model to build it with, and Build. Changes are asked for in the chat, which
 * writes a new version here. While it builds, its steps tick off live.
 */
export function PlanView({
  plan,
  models,
  modelId,
  modelParams,
  onModelChange,
  onBuild,
  canBuild,
  progress,
}: {
  plan: Plan;
  models: ModelOption[];
  modelId: string;
  modelParams: ModelParam[];
  onModelChange: (modelId: string, params: ModelParam[]) => void;
  onBuild: () => void;
  /** Nothing else is running in the chat and the user may run the agent. */
  canBuild: boolean;
  /** The Build run's to-dos, live while it works. */
  progress: TodoItem[] | null;
}) {
  const status = STATUS[plan.status];
  const building = plan.status === "building";
  const done = progress?.filter((t) => t.status === "completed").length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b bg-background/80 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
            <ClipboardList className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide">Plan</span>
              {plan.version > 1 && <span>· version {plan.version}</span>}
              <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", status.className)}>{status.label}</span>
            </div>
            <h2 dir="auto" className="truncate text-[15px] font-bold leading-tight">
              {plan.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <ModelPicker models={models} modelId={modelId} params={modelParams} onChange={onModelChange} disabled={building || !canBuild} />
            <Button
              onClick={onBuild}
              disabled={building || !canBuild}
              className="h-9 gap-2 rounded-xl bg-[#400095] px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
            >
              {building ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : plan.status === "built" ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <Hammer className="h-4 w-4" />
              )}
              {building ? "Building…" : plan.status === "built" ? "Build again" : "Build"}
            </Button>
          </div>
        </div>
        {plan.status === "draft" && (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
            Want something different? Ask in the chat and Vera revises this plan. Nothing in your store changes until you press Build.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-8 py-6">
          {progress && progress.length > 0 && (
            <div className="mb-6 rounded-xl border bg-muted/20 p-4">
              <div className="mb-2.5 flex items-center justify-between text-[12px]">
                <span className="font-semibold">{building ? "Building" : "Progress"}</span>
                <span className="text-muted-foreground">
                  {done} of {progress.length} done
                </span>
              </div>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-[#400095] transition-all dark:bg-[#F76D01]" style={{ width: `${(done / progress.length) * 100}%` }} />
              </div>
              <ul className="space-y-1.5">
                {progress.map((t) => (
                  <li key={t.id} dir="auto" className="flex items-start gap-2 text-[12.5px]">
                    {t.status === "completed" ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    ) : t.status === "in_progress" ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#6B358D] dark:text-[#F76D01]" />
                    ) : t.status === "cancelled" ? (
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    )}
                    <span className={cn(t.status === "completed" && "text-muted-foreground", t.status === "cancelled" && "line-through opacity-60")}>{t.content}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Markdown text={plan.content} className="prose-base" />
          {plan.status === "built" && (
            <p className="mt-6 flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> This plan was built. Ask in the chat to change it and build again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

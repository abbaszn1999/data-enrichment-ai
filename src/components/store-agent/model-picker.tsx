"use client";

import { Check, ChevronDown, Cpu, Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MODEL_PRICING, priceSheet } from "@/lib/store-agent/pricing";
import type { ModelParam } from "@/lib/store-agent/protocol";
import { cn } from "@/lib/utils";
import type { ModelOption } from "./api";

const EFFORT_IDS = ["reasoning_effort", "reasoning", "effort"];

const value = (params: ModelParam[], id: string) => params.find((p) => p.id === id)?.value;

function withParam(params: ModelParam[], id: string, v: string): ModelParam[] {
  return params.some((p) => p.id === id) ? params.map((p) => (p.id === id ? { id, value: v } : p)) : [...params, { id, value: v }];
}

/** Params for a model the user switches to: its defaults, keeping Fast when both support it. */
function paramsForModel(model: ModelOption, current: ModelParam[]): ModelParam[] {
  let params = [...model.defaultParams];
  const fast = value(current, "fast");
  if (fast && model.parameters.some((p) => p.id === "fast")) params = withParam(params, "fast", fast);
  return params;
}

function label(model: ModelOption | undefined, params: ModelParam[]): string {
  if (!model) return "Model";
  const effortParam = model.parameters.find((p) => EFFORT_IDS.includes(p.id));
  const effort = effortParam && effortParam.values.find((v) => v.value === value(params, effortParam.id))?.displayName;
  const ctxParam = model.parameters.find((p) => p.id === "context");
  const ctx = ctxParam && value(params, "context") && ctxParam.values[0]?.value !== value(params, "context")
    ? ctxParam.values.find((v) => v.value === value(params, "context"))?.displayName
    : null;
  return [model.displayName, ctx, effort, value(params, "fast") === "true" ? "Fast" : null].filter(Boolean).join(" ");
}

const credits = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(n >= 1 ? 1 : 2));

export function ModelPicker({
  models,
  modelId,
  params,
  onChange,
  disabled,
}: {
  models: ModelOption[];
  modelId: string;
  params: ModelParam[];
  onChange: (modelId: string, params: ModelParam[]) => void;
  disabled?: boolean;
}) {
  const model = models.find((m) => m.id === modelId);
  const fastParam = model?.parameters.find((p) => p.id === "fast");
  const ctxParam = model?.parameters.find((p) => p.id === "context");
  const effortParam = model?.parameters.find((p) => EFFORT_IDS.includes(p.id));
  const sheet = MODEL_PRICING[modelId] ? priceSheet(modelId, params) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="flex h-8 min-w-0 max-w-[180px] items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground"
        >
          {value(params, "fast") === "true" ? <Zap className="h-3.5 w-3.5 shrink-0" /> : <Cpu className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{label(model, params)}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        {fastParam && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              onChange(modelId, withParam(params, "fast", value(params, "fast") === "true" ? "false" : "true"));
            }}
            className="flex items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" /> Fast
            </span>
            <span
              className={cn(
                "relative h-4 w-7 rounded-full transition-colors",
                value(params, "fast") === "true" ? "bg-emerald-500" : "bg-muted-foreground/30"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all",
                  value(params, "fast") === "true" ? "start-3.5" : "start-0.5"
                )}
              />
            </span>
          </DropdownMenuItem>
        )}
        {ctxParam && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="flex justify-between">
              <span>Context</span>
              <span className="ms-auto me-1 text-muted-foreground">
                {ctxParam.values.find((v) => v.value === value(params, "context"))?.displayName ?? ctxParam.values[0]?.displayName}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {ctxParam.values.map((v, i) => (
                <DropdownMenuItem key={v.value} onSelect={() => onChange(modelId, withParam(params, "context", v.value))}>
                  <span className="flex-1">{v.displayName}</span>
                  {i > 0 && MODEL_PRICING[modelId]?.longContext && (
                    <span className="me-2 text-[10.5px] text-muted-foreground">long prompts {MODEL_PRICING[modelId]!.longContext!.multiplier}×</span>
                  )}
                  {(value(params, "context") ?? ctxParam.values[0]?.value) === v.value && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {effortParam && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="flex justify-between">
              <span>Effort</span>
              <span className="ms-auto me-1 text-muted-foreground">
                {effortParam.values.find((v) => v.value === value(params, effortParam.id))?.displayName ?? "Default"}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {effortParam.values.map((v) => (
                <DropdownMenuItem key={v.value} onSelect={() => onChange(modelId, withParam(params, effortParam.id, v.value))}>
                  <span className="flex-1">{v.displayName}</span>
                  {value(params, effortParam.id) === v.value && <Check className="h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {(fastParam || ctxParam || effortParam) && <DropdownMenuSeparator />}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex justify-between">
            <span>Model</span>
            <span className="ms-auto me-1 truncate text-muted-foreground">{model?.displayName ?? modelId}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            {models.map((m) => {
              const p = MODEL_PRICING[m.id] ? priceSheet(m.id, m.defaultParams) : null;
              return (
                <DropdownMenuItem key={m.id} onSelect={() => onChange(m.id, paramsForModel(m, params))} className="flex items-start gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium">{m.displayName}</div>
                    {p && (
                      <div className="text-[10.5px] text-muted-foreground">
                        {credits(p.creditsPerMillion.input)} in · {credits(p.creditsPerMillion.output)} out credits / 1M tokens
                      </div>
                    )}
                  </div>
                  {m.id === modelId && <Check className="mt-0.5 h-3.5 w-3.5" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {sheet && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="space-y-0.5 py-1.5 text-[10.5px] font-normal leading-relaxed text-muted-foreground">
              <div>
                {credits(sheet.creditsPerMillion.input)} credits / 1M input · {credits(sheet.creditsPerMillion.cacheRead)} cached ·{" "}
                {credits(sheet.creditsPerMillion.output)} output
              </div>
              {sheet.note && <div>{sheet.note}</div>}
            </DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { Filter, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeAnalyticsRules } from "@/lib/analytics/rules";
import type { AnalyticsPageType, AnalyticsRuleConfig } from "@/lib/analytics/types";

export function AnalyticsRulesEmpty({
  pageType,
  canManage,
  onSetup,
}: {
  pageType: AnalyticsPageType;
  canManage: boolean;
  onSetup: () => void;
}) {
  const label = pageType === "plp" ? "PLP" : "product";
  const example = pageType === "plp" ? "/collections/" : "/product/";
  return (
    <div className="rounded-2xl border border-dashed border-border/80 bg-card/60 px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
        <Filter className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-bold">Set {label} URL patterns</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Analytics will keep only pages that match your rules, then show the same metrics as Overview.
        {canManage
          ? ` Start with a simple path such as ${example}.`
          : " Ask an owner or admin to save the first rule set."}
      </p>
      {canManage ? (
        <Button className="mt-5" onClick={onSetup}>
          <Settings className="mr-1.5 h-4 w-4" />
          Set up {label} rules
        </Button>
      ) : null}
    </div>
  );
}

export function AnalyticsRulesBanner({ rules }: { rules: AnalyticsRuleConfig }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[#400095]/20 bg-[#400095]/5 px-4 py-3 dark:border-[#F76D01]/20 dark:bg-[#F76D01]/8">
      <Filter className="mt-0.5 h-4 w-4 shrink-0 text-[#400095] dark:text-[#F76D01]" />
      <p className="text-xs leading-relaxed">
        <span className="font-semibold">Active filter:</span>{" "}
        <span className="font-mono">{describeAnalyticsRules(rules)}</span>
      </p>
    </div>
  );
}

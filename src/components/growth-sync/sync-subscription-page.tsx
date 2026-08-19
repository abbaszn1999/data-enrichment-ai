"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Crown } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SYNC_PLANS,
  loadGrowthSync,
  saveGrowthSync,
  type SyncPlanId,
  type SyncState,
} from "@/lib/growth-sync";

const INCLUDED = [
  "Watch existing store collections",
  "Classify new products into pushed Market research projects",
  "Hourly or manual schedule",
  "Resync any rule on demand",
];

export function SyncSubscriptionPage() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params.workspaceSlug ?? "";
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => {
    setState(loadGrowthSync(slug));
  }, [slug]);

  if (!state) return null;

  const activate = (planId: SyncPlanId) => {
    const pack = SYNC_PLANS.find((row) => row.id === planId);
    if (!pack) return;
    const next: SyncState = {
      ...state,
      planId,
      creditsIncluded: pack.classifications,
      creditsUsed: 0,
    };
    setState(next);
    saveGrowthSync(slug, next);
    toast.success(`${pack.name} pack activated (example)`);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-5 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Subscription</h1>
        <p className="max-w-xl text-xs text-muted-foreground leading-relaxed">
          Sync uses its own classification credits. This is separate from the
          workspace wallet and from Market research charges.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Current pack</p>
            <p className="text-[11px] text-muted-foreground">
              {state.planId
                ? `${SYNC_PLANS.find((row) => row.id === state.planId)?.name} · ${state.creditsIncluded.toLocaleString("en-US")} classifications`
                : "None — rules stay paused until a pack is added."}
            </p>
          </div>
        </div>
        {state.planId ? (
          <Badge variant="secondary" className="text-[10px]">
            Example · local only
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {SYNC_PLANS.map((pack) => {
          const active = state.planId === pack.id;
          return (
            <div
              key={pack.id}
              className={cn(
                "flex flex-col rounded-xl border p-4",
                active ? "border-primary/40 bg-primary/5" : "border-border/70"
              )}
            >
              <p className="text-sm font-semibold">{pack.name}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                ${pack.price}
                <span className="text-xs font-normal text-muted-foreground">
                  {" "}
                  / mo
                </span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {pack.classifications.toLocaleString("en-US")} classifications
              </p>
              <p className="mt-2 flex-1 text-[11px] text-muted-foreground leading-relaxed">
                {pack.blurb}
              </p>
              <Button
                size="sm"
                variant={active ? "outline" : "default"}
                className="mt-4 h-8 text-xs"
                disabled={active}
                onClick={() => activate(pack.id)}
              >
                {active ? "Active" : "Use this pack"}
              </Button>
            </div>
          );
        })}
      </div>

      <section className="rounded-xl border border-border/70 p-4">
        <h2 className="text-sm font-semibold tracking-tight">Included</h2>
        <ul className="mt-3 space-y-2">
          {INCLUDED.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 text-xs text-muted-foreground"
            >
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

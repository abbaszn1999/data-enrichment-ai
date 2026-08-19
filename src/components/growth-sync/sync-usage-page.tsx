"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CreditCard, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadGrowthSync,
  type SyncState,
} from "@/lib/growth-sync";

export function SyncUsagePage() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params.workspaceSlug ?? "";
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => {
    setState(loadGrowthSync(slug));
  }, [slug]);

  if (!state) return null;

  const remaining = Math.max(0, state.creditsIncluded - state.creditsUsed);
  const base = `/w/${slug}/growth-sync`;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-5 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Usage</h1>
        <p className="max-w-xl text-xs text-muted-foreground leading-relaxed">
          Each newly added product that Sync classifies into a Market research
          project spends one classification credit.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Classified this period"
          value={state.creditsUsed.toLocaleString("en-US")}
        />
        <Stat
          label="Credits remaining"
          value={
            state.planId
              ? remaining.toLocaleString("en-US")
              : "Not set up"
          }
        />
        <Stat
          label="Included in pack"
          value={
            state.planId
              ? state.creditsIncluded.toLocaleString("en-US")
              : "—"
          }
        />
      </div>

      {!state.planId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            No Sync pack yet. Usage stays at zero until you add credits.
          </p>
          <Button size="sm" className="h-8 text-xs" asChild>
            <Link href={`${base}/subscription`}>
              <CreditCard className="mr-1.5 h-3.5 w-3.5" />
              View packs
            </Link>
          </Button>
        </div>
      ) : null}

      <section className="rounded-xl border border-border/70">
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Classification runs
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Example log of products Sync has already processed.
            </p>
          </div>
        </div>
        {state.activity.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No classifications yet. Turn a rule on or press Resync on the
            dashboard.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">When</TableHead>
                <TableHead className="text-xs">Rule</TableHead>
                <TableHead className="text-xs">Product</TableHead>
                <TableHead className="text-xs">Path</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.activity.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {new Date(row.at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-xs">{row.ruleName}</TableCell>
                  <TableCell className="text-xs">{row.productTitle}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {row.collectionName} → {row.projectName}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {row.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 p-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}

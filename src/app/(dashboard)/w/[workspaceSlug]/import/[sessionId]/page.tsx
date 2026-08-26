"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  Package,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/brand/page-loader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getImportSession, type ImportSession } from "@/lib/supabase";
import { getImportSteps } from "@/components/import/import-stepper";
import type { SessionKind } from "@/types";
import { useWorkspaceContext } from "../../workspace-context";

/** `step` matches the numbering in getImportSteps (upload is 1). PLP skips
 * the matching step entirely, so its steps are numbered one lower. */
const STATUS_INFO: Record<string, { label: string; color: string; step: number; plpStep: number }> = {
  matching: { label: "Matching Rules", color: "text-purple-600", step: 2, plpStep: 1 },
  review: { label: "Review Results", color: "text-amber-600", step: 3, plpStep: 2 },
  enriching: { label: "Enrichment", color: "text-indigo-600", step: 4, plpStep: 3 },
  completed: { label: "Completed", color: "text-green-600", step: 5, plpStep: 4 },
  cancelled: { label: "Cancelled", color: "text-gray-600", step: 0, plpStep: 0 },
};

export default function SessionOverviewPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const sessionId = params.sessionId as string;
  const { workspace } = useWorkspaceContext();

  const [session, setSession] = useState<ImportSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    getImportSession(sessionId)
      .then(setSession)
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <PageLoader />;
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-muted-foreground">Session not found</p>
        <Button variant="outline" size="sm" onClick={() => router.push(`/w/${slug}/import`)}>
          Back to Catalog Intelligence
        </Button>
      </div>
    );
  }

  const statusInfo = STATUS_INFO[session.status] || STATUS_INFO.matching;
  const basePath = `/w/${slug}/import/${session.id}`;

  const kind: SessionKind = (session.kind as SessionKind) ?? "product";
  const isPlp = kind === "plp";
  const info = { ...statusInfo, step: isPlp ? statusInfo.plpStep : statusInfo.step };
  const steps = getImportSteps(kind)
    .filter((step) => step.segment !== null)
    .map((step) => ({
      num: step.num,
      label: step.label,
      href: `${basePath}/${step.segment}`,
      done: info.step > step.num,
    }));

  // Determine the current step link. PLP has no matching/rules step at all.
  const currentStepHref =
    session.status === "matching" ? `${basePath}/${isPlp ? "review" : "rules"}` :
    session.status === "review" ? `${basePath}/review` :
    session.status === "enriching" ? `${basePath}/enrich` :
    session.status === "completed" ? `${basePath}/enrich` :
    `${basePath}/${isPlp ? "review" : "rules"}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">{session.name}</h1>
          <Badge variant="outline" className="text-[10px]">
            {kind === "plp" ? "PLP pages" : "Products"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Session overview</p>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2">
        {steps.map((step, i) => (
          <div key={step.num} className="flex items-center gap-2">
            <Link
              href={step.href}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                info.step === step.num
                  ? "bg-primary text-primary-foreground"
                  : step.done
                  ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step.done ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold">{step.num}</span>}
              <span>{step.label}</span>
            </Link>
            {i < steps.length - 1 && <div className={`w-8 h-0.5 ${step.done ? "bg-green-400" : "bg-muted"}`} />}
          </div>
        ))}
      </div>

      {/* Session Details */}
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase font-medium">Status</div>
            <Badge variant="secondary" className={`${info.color}`}>{info.label}</Badge>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase font-medium">Created</div>
            <div className="text-xs">{new Date(session.created_at).toLocaleString()}</div>
          </div>
        </div>

        {session.notes && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase font-medium">Notes</div>
            <div className="text-xs text-muted-foreground">{session.notes}</div>
          </div>
        )}

        {/* Stats — PLP has no "existing" concept, so it drops that column */}
        <div className={`grid gap-3 pt-2 border-t ${isPlp ? "grid-cols-3" : "grid-cols-4"}`}>
          <div className="text-center">
            <div className="text-lg font-bold">{session.total_rows}</div>
            <div className="text-[9px] text-muted-foreground">Total Rows</div>
          </div>
          {!isPlp && (
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">{session.existing_count}</div>
              <div className="text-[9px] text-muted-foreground">Existing</div>
            </div>
          )}
          <div className="text-center">
            <div className="text-lg font-bold text-blue-600">{session.new_count}</div>
            <div className="text-[9px] text-muted-foreground">
              {isPlp ? "Pages" : "New"}
            </div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-purple-600">{session.enriched_count}</div>
            <div className="text-[9px] text-muted-foreground">Enriched</div>
          </div>
        </div>
      </Card>

      {/* Action */}
      <Button className="w-full gap-2" onClick={() => router.push(currentStepHref)}>
        <ArrowRight className="h-4 w-4" />
        {session.status === "completed" ? "View Results" : "Continue Session"}
      </Button>
    </div>
  );
}

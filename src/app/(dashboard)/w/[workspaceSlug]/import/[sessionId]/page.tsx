"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Loader2,
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
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getImportSession, type ImportSession } from "@/lib/supabase";
import { useWorkspaceContext } from "../../layout";

const STATUS_INFO: Record<string, { label: string; color: string; step: number }> = {
  matching: { label: "Matching Rules", color: "text-purple-600", step: 1 },
  review: { label: "Review Results", color: "text-amber-600", step: 2 },
  enriching: { label: "Enrichment", color: "text-indigo-600", step: 3 },
  completed: { label: "Completed", color: "text-green-600", step: 4 },
  cancelled: { label: "Cancelled", color: "text-gray-600", step: 0 },
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
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-muted-foreground">Session not found</p>
        <Button variant="outline" size="sm" onClick={() => router.push(`/w/${slug}/import`)}>
          Back to Imports
        </Button>
      </div>
    );
  }

  const info = STATUS_INFO[session.status] || STATUS_INFO.matching;
  const basePath = `/w/${slug}/import/${session.id}`;

  const steps = [
    { num: 1, label: "Matching Rules", href: `${basePath}/rules`, done: info.step > 1 },
    { num: 2, label: "Review Results", href: `${basePath}/review`, done: info.step > 2 },
    { num: 3, label: "Enrichment Tool", href: `${basePath}/enrich`, done: info.step > 3 },
  ];

  // Determine the current step link
  const currentStepHref =
    session.status === "matching" ? `${basePath}/rules` :
    session.status === "review" ? `${basePath}/review` :
    session.status === "enriching" ? `${basePath}/enrich` :
    session.status === "completed" ? `${basePath}/enrich` :
    `${basePath}/rules`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">{session.name}</h1>
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

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 pt-2 border-t">
          <div className="text-center">
            <div className="text-lg font-bold">{session.total_rows}</div>
            <div className="text-[9px] text-muted-foreground">Total Rows</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-green-600">{session.existing_count}</div>
            <div className="text-[9px] text-muted-foreground">Existing</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-blue-600">{session.new_count}</div>
            <div className="text-[9px] text-muted-foreground">New</div>
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

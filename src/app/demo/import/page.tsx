"use client";

import Link from "next/link";
import {
  Upload,
  Plus,
  Clock,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockImportSessions } from "../mock-data";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusConfig: Record<string, { color: string; icon: any; label: string }> = {
  mapping: { color: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 border-blue-200", icon: FileSpreadsheet, label: "Column Mapping" },
  matching: { color: "bg-purple-50 dark:bg-purple-950/30 text-purple-700 border-purple-200", icon: Loader2, label: "Matching" },
  review: { color: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 border-amber-200", icon: AlertCircle, label: "Review" },
  enriching: { color: "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 border-indigo-200", icon: Loader2, label: "Enriching" },
  completed: { color: "bg-green-50 dark:bg-green-950/30 text-green-700 border-green-200", icon: CheckCircle2, label: "Completed" },
};

export default function DemoImportPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Upload className="h-5 w-5" /> Import Sessions
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{mockImportSessions.length} import sessions</p>
        </div>
        <Link href="/demo/import/new">
          <Button size="sm" className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> New Import
          </Button>
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {["All", "In Progress", "Completed"].map((tab) => (
          <button
            key={tab}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === "All" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Sessions list */}
      <div className="space-y-3">
        {mockImportSessions.map((session) => {
          const sc = statusConfig[session.status];
          const StatusIcon = sc.icon;
          return (
            <Link key={session.id} href="/demo/import/session">
              <Card className="p-5 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-semibold">{session.name}</h3>
                      <Badge variant="outline" className={`text-[9px] gap-1 ${sc.color}`}>
                        <StatusIcon className={`h-2.5 w-2.5 ${session.status === "matching" || session.status === "enriching" ? "animate-spin" : ""}`} />
                        {sc.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                      <span className="font-medium">{session.supplier}</span>
                      <span>{session.totalRows} total rows</span>
                      {session.existingCount > 0 && (
                        <span className="text-amber-600">{session.existingCount} existing</span>
                      )}
                      {session.newCount > 0 && (
                        <span className="text-blue-600">{session.newCount} new</span>
                      )}
                      {session.enrichedCount > 0 && (
                        <span className="text-green-600">{session.enrichedCount} enriched</span>
                      )}
                    </div>

                    {/* Progress bar for non-completed */}
                    {session.status !== "mapping" && (
                      <div className="w-full max-w-md h-1.5 bg-muted rounded-full mt-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            session.status === "completed" ? "bg-green-500" : "bg-primary"
                          }`}
                          style={{
                            width: `${session.status === "completed" ? 100 : session.status === "review" ? 60 : 30}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo(session.createdAt)}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">by {session.createdBy}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

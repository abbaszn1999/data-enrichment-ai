"use client";

import Link from "next/link";
import {
  Package,
  FolderTree,
  Upload,
  Download,
  Users,
  TrendingUp,
  Clock,
  ArrowUpRight,
  Sparkles,
  FileSpreadsheet,
  UserPlus,
  FolderPlus,
  ShoppingCart,
  FileUp,
  FileDown,
  UserCheck,
  Settings2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { mockDashboardStats, mockActivityLog, mockImportSessions } from "../mock-data";

const actionIcons: Record<string, any> = {
  export_generated: FileDown,
  enrichment_completed: Sparkles,
  import_completed: FileUp,
  products_updated: ShoppingCart,
  file_uploaded: Upload,
  member_invited: UserPlus,
  category_created: FolderPlus,
  products_imported: FileSpreadsheet,
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DemoDashboardPage() {
  const stats = mockDashboardStats;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">TechStore Electronics overview</p>
        </div>
        <div className="flex gap-2">
          <Link href="/demo/products/upload">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <Upload className="h-3.5 w-3.5" /> Upload Products
            </Button>
          </Link>
          <Link href="/demo/import/new">
            <Button size="sm" className="gap-1.5 text-xs">
              <FileSpreadsheet className="h-3.5 w-3.5" /> New Import
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <Badge variant="secondary" className="text-[9px]">+12 this week</Badge>
          </div>
          <div className="text-2xl font-bold">{stats.totalProducts.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Products</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <FolderTree className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold">{stats.totalCategories}</div>
          <div className="text-xs text-muted-foreground">Categories</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <Badge variant="secondary" className="text-[9px] bg-green-50 dark:bg-green-950/30 text-green-700">{stats.enrichmentRate}%</Badge>
          </div>
          <div className="text-2xl font-bold">{Math.round(stats.totalProducts * stats.enrichmentRate / 100)}</div>
          <div className="text-xs text-muted-foreground">AI Enriched</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-bold">{stats.teamMembers}</div>
          <div className="text-xs text-muted-foreground">Team Members</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Imports */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent Imports</h2>
            <Link href="/demo/import" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {mockImportSessions.map((session) => (
              <Link key={session.id} href="/demo/import/session">
                <Card className="p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{session.name}</span>
                        <Badge variant={
                          session.status === "completed" ? "secondary" :
                          session.status === "review" ? "outline" : "default"
                        } className={`text-[9px] ${
                          session.status === "completed" ? "bg-green-50 dark:bg-green-950/30 text-green-700" :
                          session.status === "review" ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 border-amber-200" :
                          "bg-blue-50 dark:bg-blue-950/30 text-blue-700"
                        }`}>
                          {session.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground">
                        <span>{session.supplier}</span>
                        <span>|</span>
                        <span>{session.totalRows} rows</span>
                        <span>|</span>
                        <span>{session.existingCount} existing, {session.newCount} new</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {timeAgo(session.createdAt)}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Activity Log */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold">Recent Activity</h2>
          <div className="space-y-1">
            {mockActivityLog.slice(0, 6).map((activity) => {
              const Icon = actionIcons[activity.action] || Settings2;
              return (
                <div key={activity.id} className="flex items-start gap-2.5 py-2 border-b last:border-0">
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] leading-relaxed">{activity.details}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-muted-foreground">{activity.user}</span>
                      <span className="text-[9px] text-muted-foreground">{timeAgo(activity.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Enrichment Progress */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Enrichment Progress</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">AI-enriched products across your catalog</p>
          </div>
          <span className="text-lg font-bold text-primary">{stats.enrichmentRate}%</span>
        </div>
        <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full transition-all" style={{ width: `${stats.enrichmentRate}%` }} />
        </div>
        <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
          <span>{Math.round(stats.totalProducts * stats.enrichmentRate / 100)} enriched</span>
          <span>{stats.totalProducts - Math.round(stats.totalProducts * stats.enrichmentRate / 100)} remaining</span>
        </div>
      </Card>
    </div>
  );
}

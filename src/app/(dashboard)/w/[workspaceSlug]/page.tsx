"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Package,
  FolderTree,
  Upload,
  Users,
  Sparkles,
  Clock,
  ArrowRight,
  Loader2,
  TrendingUp,
  Activity,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "./layout";
import { createClient } from "@/lib/supabase-browser";
import { loadProductsJson, loadCategoriesJson } from "@/lib/storage-helpers";

interface DashboardStats {
  totalProducts: number;
  totalCategories: number;
  recentImports: number;
  teamMembers: number;
}

export default function WorkspaceDashboardPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace, role, wsLoading } = useWorkspaceContext();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (wsLoading) return;
    if (!workspace) { setLoading(false); return; }

    const supabase = createClient();
    let cancelled = false;

    async function loadStats() {
      try {
        const [products, categories, sessionsRes, membersRes, activityRes] = await Promise.all([
          loadProductsJson(workspace!.id),
          loadCategoriesJson(workspace!.id),
          supabase.from("import_sessions").select("id", { count: "exact", head: true }).eq("workspace_id", workspace!.id),
          supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspace!.id),
          supabase.from("activity_log").select("*").eq("workspace_id", workspace!.id).order("created_at", { ascending: false }).limit(5),
        ]);

        if (cancelled) return;

        setStats({
          totalProducts: products.length,
          totalCategories: categories.length,
          recentImports: sessionsRes.count ?? 0,
          teamMembers: membersRes.count ?? 0,
        });
        setActivities(activityRes.data ?? []);
      } catch (err) {
        console.error("[Dashboard] loadStats error:", err);
      }
      if (!cancelled) setLoading(false);
    }

    loadStats();
    return () => { cancelled = true; };
  }, [workspace, wsLoading]);

  const basePath = `/w/${slug}`;

  const statCards = [
    { label: "Products", value: stats?.totalProducts ?? 0, icon: Package, href: `${basePath}/products`, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
    { label: "Categories", value: stats?.totalCategories ?? 0, icon: FolderTree, href: `${basePath}/categories`, color: "text-green-600 bg-green-50 dark:bg-green-950/30" },
    { label: "Imports", value: stats?.recentImports ?? 0, icon: Upload, href: `${basePath}/import`, color: "text-purple-600 bg-purple-50 dark:bg-purple-950/30" },
    { label: "Team Members", value: stats?.teamMembers ?? 0, icon: Users, href: `${basePath}/team`, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Welcome to {workspace?.name}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <div className="text-[10px] text-muted-foreground">{stat.label}</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href={`${basePath}/products/upload`}>
          <Card className="p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Upload className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium">Upload Products</div>
                  <div className="text-[10px] text-muted-foreground">Import your master product catalog</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Card>
        </Link>

        <Link href={`${basePath}/import/new`}>
          <Card className="p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                </div>
                <div>
                  <div className="text-sm font-medium">New Import</div>
                  <div className="text-[10px] text-muted-foreground">Upload supplier sheet for matching</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Card>
        </Link>

        <Link href={`${basePath}/usage`}>
          <Card className="p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <div className="text-sm font-medium">Usage & Credits</div>
                  <div className="text-[10px] text-muted-foreground">View AI credits and analytics</div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Card>
        </Link>
      </div>

      {/* Recent Activity */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4" /> Recent Activity
          </h2>
        </div>
        {activities.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No activity yet. Start by uploading products or creating an import.
          </p>
        ) : (
          <div className="space-y-3">
            {activities.map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-xs">
                <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Activity className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{"User"}</span>{" "}
                  <span className="text-muted-foreground">{a.action}</span>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(a.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

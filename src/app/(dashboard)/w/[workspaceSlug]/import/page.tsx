"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Upload,
  Plus,
  Clock,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Search,
  MoreHorizontal,
  Trash2,
  Copy,
  Archive,
  Package,
  Tag,
  X,
  BarChart3,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "../layout";
import { getImportSessions, deleteImportSession } from "@/lib/supabase";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const statusConfig: Record<string, { color: string; bgColor: string; dotColor: string; label: string }> = {
  matching: { color: "text-purple-700 dark:text-purple-400", bgColor: "bg-purple-50 dark:bg-purple-950/30 border-purple-200", dotColor: "bg-purple-500", label: "Matching" },
  rules: { color: "text-blue-700 dark:text-blue-400", bgColor: "bg-blue-50 dark:bg-blue-950/30 border-blue-200", dotColor: "bg-blue-500", label: "Rules" },
  review: { color: "text-amber-700 dark:text-amber-400", bgColor: "bg-amber-50 dark:bg-amber-950/30 border-amber-200", dotColor: "bg-amber-500", label: "Review" },
  enriching: { color: "text-indigo-700 dark:text-indigo-400", bgColor: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200", dotColor: "bg-indigo-500", label: "Enriching" },
  completed: { color: "text-green-700 dark:text-green-400", bgColor: "bg-green-50 dark:bg-green-950/30 border-green-200", dotColor: "bg-green-500", label: "Completed" },
  cancelled: { color: "text-gray-700 dark:text-gray-400", bgColor: "bg-gray-50 dark:bg-gray-950/30 border-gray-200", dotColor: "bg-gray-400", label: "Cancelled" },
};

const tagColors: Record<string, string> = {
  monthly: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  priority: "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400",
  urgent: "bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400",
  quarterly: "bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400",
};

export default function ImportPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace } = useWorkspaceContext();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "rows">("newest");
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    getImportSessions(workspace.id)
      .then(setSessions)
      .catch((err) => console.error("Failed to load import sessions:", err))
      .finally(() => setLoading(false));
  }, [workspace]);

  const stats = useMemo(() => ({
    total: sessions.length,
    inProgress: sessions.filter((s) => s.status !== "completed" && s.status !== "cancelled").length,
    completed: sessions.filter((s) => s.status === "completed").length,
    totalProducts: sessions.reduce((sum, s) => sum + (s.total_rows || 0), 0),
  }), [sessions]);

  const filtered = useMemo(() => {
    let result = [...sessions];
    if (activeTab === "progress") result = result.filter((s) => s.status !== "completed" && s.status !== "cancelled");
    if (activeTab === "completed") result = result.filter((s) => s.status === "completed");
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter((sess) =>
        sess.name.toLowerCase().includes(s) ||
        (sess.tags || []).some((t: string) => t.toLowerCase().includes(s))
      );
    }
    if (sortBy === "newest") result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (sortBy === "oldest") result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (sortBy === "rows") result.sort((a, b) => (b.total_rows || 0) - (a.total_rows || 0));
    return result;
  }, [sessions, activeTab, searchTerm, sortBy]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this import session?")) return;
    try {
      await deleteImportSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      alert(err?.message || "Failed to delete");
    }
    setOpenMenu(null);
  };

  const tabs = [
    { id: "all", label: "All", count: stats.total },
    { id: "progress", label: "In Progress", count: stats.inProgress },
    { id: "completed", label: "Completed", count: stats.completed },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Upload className="h-5 w-5" /> Import Sessions
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{stats.total} sessions</p>
        </div>
        <Link href={`/w/${slug}/import/new`}>
          <Button size="sm" className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> New Import
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Sessions", value: stats.total, icon: BarChart3, color: "text-primary bg-primary/10" },
          { label: "In Progress", value: stats.inProgress, icon: Loader2, color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
          { label: "Completed", value: stats.completed, icon: CheckCircle2, color: "text-green-600 bg-green-50 dark:bg-green-950/30" },
          { label: "Total Products", value: stats.totalProducts, icon: Package, color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30" },
        ].map((s) => (
          <Card key={s.label} className="p-3 flex items-center gap-3">
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${s.color}`}>
              <s.icon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-lg font-bold">{s.value}</div>
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Tabs + Search + Sort */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {tab.label}
              <span className={`text-[9px] px-1 py-0 rounded-full ${activeTab === tab.id ? "bg-primary-foreground/20" : "bg-background"}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 w-48 pl-8 pr-7 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="h-8 px-2.5 text-xs rounded-md border bg-background">
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="rows">Most Products</option>
        </select>
      </div>

      {/* Sessions List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <Card className="p-10 flex flex-col items-center gap-2 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              {sessions.length === 0 ? "No import sessions yet. Start your first import!" : "No sessions match your search"}
            </p>
          </Card>
        )}

        {filtered.map((session) => {
          const sc = statusConfig[session.status] || statusConfig.matching;
          const enrichedCount = session.enriched_count || 0;
          const totalRows = session.total_rows || 1;
          const realProgress = session.status === "completed" ? 100
            : session.status === "cancelled" ? 0
            : Math.round((enrichedCount / totalRows) * 100);

          return (
            <Card key={session.id} className="hover:border-primary/40 hover:shadow-sm transition-all group relative">
              <Link href={`/w/${slug}/import/${session.id}/${session.status === "enriching" || session.status === "completed" ? "enrich" : session.status === "review" ? "review" : "rules"}`} className="block p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">{session.name}</h3>
                      <Badge variant="outline" className={`text-[9px] gap-1 ${sc.bgColor}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${sc.dotColor}`} />
                        {sc.label}
                      </Badge>
                      {(session.tags || []).map((tag: string) => (
                        <Badge key={tag} variant="secondary" className={`text-[8px] px-1.5 py-0 ${tagColors[tag] || ""}`}>
                          <Tag className="h-2 w-2 mr-0.5" /> {tag}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Package className="h-2.5 w-2.5" /> {session.total_rows} rows
                      </span>
                      {session.existing_count > 0 && (
                        <span className="text-amber-600">{session.existing_count} existing</span>
                      )}
                      {session.new_count > 0 && (
                        <span className="text-blue-600">{session.new_count} new</span>
                      )}
                      {session.enriched_count > 0 && (
                        <span className="text-green-600">{session.enriched_count} enriched</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                      <div className="w-full max-w-sm h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${session.status === "completed" ? "bg-green-500" : "bg-primary"}`}
                          style={{ width: `${realProgress}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-bold ${sc.color}`}>{realProgress}%</span>
                    </div>
                  </div>
                  <div className="text-right ml-4 shrink-0">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                      <Clock className="h-2.5 w-2.5" /> {timeAgo(session.created_at)}
                    </div>
                  </div>
                </div>
              </Link>

              <div className="absolute top-3 right-3">
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenu(openMenu === session.id ? null : session.id); }}
                  className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {openMenu === session.id && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setOpenMenu(null)} />
                    <div className="absolute right-0 top-8 w-36 bg-background border rounded-lg shadow-lg py-1 z-40">
                      <div className="border-t my-1" />
                      <button
                        onClick={(e) => { e.preventDefault(); handleDelete(session.id); }}
                        className="w-full px-3 py-1.5 text-[11px] text-left hover:bg-destructive/10 text-destructive flex items-center gap-2"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

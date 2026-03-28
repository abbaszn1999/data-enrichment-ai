"use client";

import { useState, useMemo } from "react";
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
  Search,
  ArrowUpDown,
  MoreHorizontal,
  Trash2,
  Copy,
  Archive,
  Package,
  TrendingUp,
  Timer,
  Tag,
  X,
  RefreshCw,
  Sparkles,
  BarChart3,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockImportSessions } from "../mock-data";

/* ── Extended mock data ────────────────────────────────── */

const extendedSessions = [
  {
    ...mockImportSessions[0],
    tags: ["monthly", "priority"],
    duration: "12m 34s",
    totalImported: 150,
    priceChanges: 42,
    stockChanges: 88,
    finishedAt: "2025-05-15T10:12:34Z",
  },
  {
    ...mockImportSessions[1],
    tags: ["monthly"],
    duration: null,
    totalImported: 0,
    priceChanges: 0,
    stockChanges: 0,
    finishedAt: null,
  },
  {
    ...mockImportSessions[2],
    tags: [],
    duration: null,
    totalImported: 0,
    priceChanges: 0,
    stockChanges: 0,
    finishedAt: null,
  },
];

/* ── Helpers ───────────────────────────────────────────── */

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const statusConfig: Record<string, { color: string; bgColor: string; icon: any; label: string; progress: number }> = {
  mapping: { color: "text-blue-700 dark:text-blue-400", bgColor: "bg-blue-50 dark:bg-blue-950/30 border-blue-200", icon: FileSpreadsheet, label: "Column Mapping", progress: 15 },
  matching: { color: "text-purple-700 dark:text-purple-400", bgColor: "bg-purple-50 dark:bg-purple-950/30 border-purple-200", icon: Loader2, label: "Matching", progress: 35 },
  review: { color: "text-amber-700 dark:text-amber-400", bgColor: "bg-amber-50 dark:bg-amber-950/30 border-amber-200", icon: AlertCircle, label: "Review", progress: 60 },
  enriching: { color: "text-indigo-700 dark:text-indigo-400", bgColor: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200", icon: Loader2, label: "Enriching", progress: 80 },
  completed: { color: "text-green-700 dark:text-green-400", bgColor: "bg-green-50 dark:bg-green-950/30 border-green-200", icon: CheckCircle2, label: "Completed", progress: 100 },
};

const tagColors: Record<string, string> = {
  monthly: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  priority: "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400",
  urgent: "bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400",
  quarterly: "bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400",
};

/* ── Main Page ─────────────────────────────────────────── */

export default function DemoImportPage() {
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "rows">("newest");
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Stats
  const totalSessions = extendedSessions.length;
  const inProgress = extendedSessions.filter((s) => s.status !== "completed").length;
  const completed = extendedSessions.filter((s) => s.status === "completed").length;
  const totalProducts = extendedSessions.reduce((sum, s) => sum + s.totalRows, 0);

  // Filter
  const filtered = useMemo(() => {
    let result = [...extendedSessions];

    // Tab filter
    if (activeTab === "progress") result = result.filter((s) => s.status !== "completed");
    if (activeTab === "completed") result = result.filter((s) => s.status === "completed");

    // Search
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter(
        (sess) =>
          sess.name.toLowerCase().includes(s) ||
          sess.supplier.toLowerCase().includes(s) ||
          sess.tags.some((t) => t.toLowerCase().includes(s))
      );
    }

    // Sort
    if (sortBy === "newest") result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (sortBy === "oldest") result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (sortBy === "rows") result.sort((a, b) => b.totalRows - a.totalRows);

    return result;
  }, [activeTab, searchTerm, sortBy]);

  const tabs = [
    { id: "all", label: "All", count: totalSessions },
    { id: "progress", label: "In Progress", count: inProgress },
    { id: "completed", label: "Completed", count: completed },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Upload className="h-5 w-5" /> Import Sessions
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{totalSessions} import sessions</p>
        </div>
        <Link href="/demo/import/new">
          <Button size="sm" className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> New Import
          </Button>
        </Link>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <BarChart3 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="text-lg font-bold">{totalSessions}</div>
            <div className="text-[10px] text-muted-foreground">Total Sessions</div>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
            <Loader2 className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <div className="text-lg font-bold">{inProgress}</div>
            <div className="text-[10px] text-muted-foreground">In Progress</div>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-green-50 dark:bg-green-950/30 flex items-center justify-center">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <div className="text-lg font-bold">{completed}</div>
            <div className="text-[10px] text-muted-foreground">Completed</div>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
            <Package className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <div className="text-lg font-bold">{totalProducts}</div>
            <div className="text-[10px] text-muted-foreground">Total Products</div>
          </div>
        </Card>
      </div>

      {/* Filter Tabs + Search + Sort */}
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

        {/* Search */}
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

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="h-8 px-2.5 text-xs rounded-md border bg-background"
        >
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
            <p className="text-xs text-muted-foreground">No sessions match your search</p>
          </Card>
        )}

        {filtered.map((session) => {
          const sc = statusConfig[session.status];
          const StatusIcon = sc.icon;
          const isMenuOpen = openMenu === session.id;

          return (
            <Card key={session.id} className="hover:border-primary/40 hover:shadow-sm transition-all group relative">
              <Link href="/demo/import/session/rules" className="block p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    {/* Row 1: Name + Status + Tags */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">{session.name}</h3>
                      <Badge variant="outline" className={`text-[9px] gap-1 ${sc.bgColor}`}>
                        <StatusIcon className={`h-2.5 w-2.5 ${session.status === "matching" || session.status === "enriching" ? "animate-spin" : ""}`} />
                        {sc.label}
                      </Badge>
                      {session.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className={`text-[8px] px-1.5 py-0 ${tagColors[tag] || "bg-gray-50 text-gray-600"}`}>
                          <Tag className="h-2 w-2 mr-0.5" />
                          {tag}
                        </Badge>
                      ))}
                    </div>

                    {/* Row 2: Supplier + Stats */}
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1 font-medium">
                        <Users className="h-2.5 w-2.5" /> {session.supplier}
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="h-2.5 w-2.5" /> {session.totalRows} rows
                      </span>
                      {session.existingCount > 0 && (
                        <span className="flex items-center gap-1 text-amber-600">
                          <RefreshCw className="h-2.5 w-2.5" /> {session.existingCount} existing
                        </span>
                      )}
                      {session.newCount > 0 && (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Plus className="h-2.5 w-2.5" /> {session.newCount} new
                        </span>
                      )}
                      {session.enrichedCount > 0 && (
                        <span className="flex items-center gap-1 text-green-600">
                          <Sparkles className="h-2.5 w-2.5" /> {session.enrichedCount} enriched
                        </span>
                      )}
                    </div>

                    {/* Row 3: Progress Bar */}
                    <div className="flex items-center gap-3 mt-3">
                      <div className="w-full max-w-sm h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            session.status === "completed" ? "bg-green-500" : "bg-primary"
                          }`}
                          style={{ width: `${sc.progress}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-bold ${sc.color}`}>{sc.progress}%</span>
                    </div>
                  </div>

                  {/* Right side: Time + Duration */}
                  <div className="flex items-start gap-3 ml-4 shrink-0">
                    <div className="text-right space-y-1">
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                        <Clock className="h-2.5 w-2.5" />
                        {timeAgo(session.createdAt)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">by {session.createdBy}</div>
                      {session.duration && (
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                          <Timer className="h-2.5 w-2.5" />
                          {session.duration}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                  </div>
                </div>

                {/* Completed: Result Summary */}
                {session.status === "completed" && (
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t">
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      <span className="text-muted-foreground">{session.totalImported} imported</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      <span className="text-muted-foreground">{session.priceChanges} price changes</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      <span className="text-muted-foreground">{session.stockChanges} stock updates</span>
                    </div>
                  </div>
                )}
              </Link>

              {/* Actions Menu */}
              <div className="absolute top-3 right-3">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenMenu(isMenuOpen ? null : session.id);
                  }}
                  className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                {isMenuOpen && (
                  <div className="absolute right-0 top-8 w-36 bg-background border rounded-lg shadow-lg py-1 z-50">
                    <button className="w-full px-3 py-1.5 text-[11px] text-left hover:bg-muted flex items-center gap-2">
                      <Copy className="h-3 w-3" /> Duplicate
                    </button>
                    <button className="w-full px-3 py-1.5 text-[11px] text-left hover:bg-muted flex items-center gap-2">
                      <Archive className="h-3 w-3" /> Archive
                    </button>
                    <div className="border-t my-1" />
                    <button className="w-full px-3 py-1.5 text-[11px] text-left hover:bg-destructive/10 text-destructive flex items-center gap-2">
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

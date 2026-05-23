"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ImageIcon,
  Plus,
  Clock,
  CheckCircle2,
  Loader2,
  Search,
  Trash2,
  X,
  BarChart3,
  Layers,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import {
  getImageClassificationSessions,
  deleteImageClassificationSession,
  type ImageClassificationSession,
} from "@/lib/supabase";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const statusConfig: Record<
  string,
  { color: string; bgColor: string; dotColor: string; label: string }
> = {
  pending: {
    color: "text-gray-700 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-950/30 border-gray-200",
    dotColor: "bg-gray-400",
    label: "Pending",
  },
  processing: {
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30 border-blue-200",
    dotColor: "bg-blue-500",
    label: "Processing",
  },
  completed: {
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/30 border-green-200",
    dotColor: "bg-green-500",
    label: "Completed",
  },
  failed: {
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/30 border-red-200",
    dotColor: "bg-red-500",
    label: "Failed",
  },
};

export default function ImageClassifyPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace, role } = useWorkspaceContext();
  const permissions = useRole(role);
  const [sessions, setSessions] = useState<ImageClassificationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!workspace) return;
    getImageClassificationSessions(workspace.id)
      .then(setSessions)
      .catch((err) =>
        console.error("Failed to load image classification sessions:", err)
      )
      .finally(() => setLoading(false));
  }, [workspace]);

  const stats = useMemo(
    () => ({
      total: sessions.length,
      inProgress: sessions.filter(
        (s) => s.status === "processing" || s.status === "pending"
      ).length,
      completed: sessions.filter((s) => s.status === "completed").length,
      totalImages: sessions.reduce((sum, s) => sum + (s.total_images || 0), 0),
    }),
    [sessions]
  );

  const filtered = useMemo(() => {
    let result = [...sessions];
    if (activeTab === "progress")
      result = result.filter(
        (s) => s.status === "processing" || s.status === "pending"
      );
    if (activeTab === "completed")
      result = result.filter((s) => s.status === "completed");
    if (activeTab === "failed")
      result = result.filter((s) => s.status === "failed");
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter((sess) => sess.name.toLowerCase().includes(s));
    }
    result.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return result;
  }, [sessions, activeTab, searchTerm]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this image classification session?")) return;
    try {
      await deleteImageClassificationSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert((err as Error)?.message || "Failed to delete");
    }
  };

  const tabs = [
    { id: "all", label: "All", count: stats.total },
    { id: "progress", label: "In Progress", count: stats.inProgress },
    { id: "completed", label: "Completed", count: stats.completed },
    {
      id: "failed",
      label: "Failed",
      count: sessions.filter((s) => s.status === "failed").length,
    },
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
            <ImageIcon className="h-5 w-5" /> Image Classification
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Group product images automatically with AI. {stats.total}{" "}
            session{stats.total === 1 ? "" : "s"}.
          </p>
        </div>
        {permissions.canImport && (
          <Link href={`/w/${slug}/image-classify/new`}>
            <Button size="sm" className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> New Classification
            </Button>
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          {
            label: "Sessions",
            value: stats.total,
            icon: BarChart3,
            color: "text-primary bg-primary/10",
          },
          {
            label: "In Progress",
            value: stats.inProgress,
            icon: Loader2,
            color:
              "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
          },
          {
            label: "Completed",
            value: stats.completed,
            icon: CheckCircle2,
            color:
              "text-green-600 bg-green-50 dark:bg-green-950/30",
          },
          {
            label: "Total Images",
            value: stats.totalImages,
            icon: ImageIcon,
            color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
          },
        ].map((s) => (
          <Card key={s.label} className="p-3 flex items-center gap-3">
            <div
              className={`h-9 w-9 rounded-lg flex items-center justify-center ${s.color}`}
            >
              <s.icon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-lg font-bold">{s.value}</div>
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Tabs + search */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {tab.label}
              <span
                className={`text-[9px] px-1 py-0 rounded-full ${
                  activeTab === tab.id
                    ? "bg-primary-foreground/20"
                    : "bg-background"
                }`}
              >
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
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Sessions list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <Card className="p-10 flex flex-col items-center gap-2 text-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              {sessions.length === 0
                ? "No classifications yet. Upload images to get started."
                : "No sessions match your filter."}
            </p>
          </Card>
        )}

        {filtered.map((session) => {
          const sc = statusConfig[session.status] || statusConfig.pending;
          return (
            <Card
              key={session.id}
              className="hover:border-primary/40 hover:shadow-sm transition-all group relative"
            >
              <Link
                href={`/w/${slug}/image-classify/${session.id}`}
                className="block p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">{session.name}</h3>
                      <Badge
                        variant="outline"
                        className={`text-[9px] gap-1 ${sc.bgColor}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${sc.dotColor}`}
                        />
                        {sc.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ImageIcon className="h-2.5 w-2.5" />{" "}
                        {session.total_images} images
                      </span>
                      {session.group_count > 0 && (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Layers className="h-2.5 w-2.5" />{" "}
                          {session.group_count} groups
                        </span>
                      )}
                      {session.total_credits > 0 && (
                        <span>
                          {session.total_credits.toFixed(2)} credits
                        </span>
                      )}
                    </div>
                    {session.status === "failed" && session.error_message && (
                      <div className="flex items-center gap-1 mt-2 text-[10px] text-red-600">
                        <AlertCircle className="h-3 w-3" />
                        {session.error_message}
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-4 shrink-0">
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                      <Clock className="h-2.5 w-2.5" />{" "}
                      {timeAgo(session.created_at)}
                    </div>
                  </div>
                </div>
              </Link>

              {permissions.canAdmin && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDelete(session.id);
                  }}
                  className="absolute top-3 right-3 h-7 px-2 rounded-md border border-destructive/20 bg-background/90 hover:bg-destructive/10 text-destructive flex items-center gap-1 text-[11px] transition-colors z-10"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

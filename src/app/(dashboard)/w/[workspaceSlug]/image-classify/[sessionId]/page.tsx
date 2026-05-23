"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Loader2,
  ImageIcon,
  Layers,
  AlertCircle,
  Coins,
  Cpu,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "../../layout";
import {
  getImageClassificationSession,
  type ImageClassificationSession,
} from "@/lib/supabase";
import {
  loadJsonFromStorage,
  getImageClassificationResultPath,
  getImageSignedUrl,
  type ImageClassificationJson,
} from "@/lib/storage-helpers";

type ExportFormat = "json" | "csv";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToCsv(
  result: ImageClassificationJson,
  fallbackUrls: Record<string, string>
): string {
  const header = ["group_id", "url image"];
  const rows = [header.join(",")];

  const escape = (raw: unknown) => {
    const s = String(raw ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  for (const g of result.groups) {
    const urls = result.items
      .filter((it) => it.groupId === g.id)
      .map((it) => it.url || fallbackUrls[it.id])
      .filter((u): u is string => !!u && u.length > 0)
      .join("\n\n");
    rows.push([escape(g.label), escape(urls)].join(","));
  }
  return rows.join("\n");
}

export default function ImageClassifyDetailPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const sessionId = params.sessionId as string;
  const { workspace } = useWorkspaceContext();

  const [session, setSession] = useState<ImageClassificationSession | null>(null);
  const [result, setResult] = useState<ImageClassificationJson | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  // Initial + polling load
  useEffect(() => {
    if (!workspace || !sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const s = await getImageClassificationSession(sessionId);
        if (cancelled) return;
        setSession(s);
        if (s?.status === "completed" && workspace) {
          const json = await loadJsonFromStorage<ImageClassificationJson>(
            s.storage_path ||
              getImageClassificationResultPath(workspace.id, sessionId)
          );
          if (!cancelled) setResult(json);
        }
        if (s && (s.status === "pending" || s.status === "processing")) {
          setPolling(true);
          timer = setTimeout(load, 3000);
        } else {
          setPolling(false);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to load session");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [workspace, sessionId]);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        result.items.map(async (it) => {
          if (it.url) return [it.id, it.url] as const;
          const url = await getImageSignedUrl(it.storagePath, 3600);
          return [it.id, url || ""] as const;
        })
      );
      if (cancelled) return;
      setThumbUrls(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [result]);

  const groupedItems = useMemo(() => {
    if (!result) return [];
    return result.groups.map((g) => ({
      group: g,
      items: result.items.filter((it) => it.groupId === g.id),
    }));
  }, [result]);

  const handleExport = (format: ExportFormat) => {
    if (!result) return;
    if (format === "json") {
      downloadBlob(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
        `${session?.name || "classification"}.json`
      );
    } else {
      downloadBlob(
        new Blob([exportToCsv(result, thumbUrls)], { type: "text/csv;charset=utf-8" }),
        `${session?.name || "classification"}.csv`
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Session not found.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/w/${slug}/image-classify`}
            className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">{session.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[9px]">
                {session.status}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {session.total_images} images · {session.group_count} groups
              </span>
            </div>
          </div>
        </div>

        {result && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => handleExport("csv")} className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button size="sm" onClick={() => handleExport("json")} className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" /> JSON
            </Button>
          </div>
        )}
      </div>

      {(session.status === "pending" || session.status === "processing") && (
        <Card className="p-4 flex items-center gap-3 border-blue-200 bg-blue-50/40 dark:bg-blue-950/20">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <div className="text-xs">
            {session.status === "pending"
              ? "Waiting to start…"
              : "Classifying images with AI. This page refreshes automatically."}
            {polling && <span className="text-muted-foreground ml-1">(polling)</span>}
          </div>
        </Card>
      )}

      {session.status === "failed" && (
        <Card className="p-4 flex items-start gap-3 border-red-200 bg-red-50/40 dark:bg-red-950/20">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs text-red-700 dark:text-red-400">
            {session.error_message || "Classification failed."}
          </div>
        </Card>
      )}

      {error && (
        <Card className="p-3 text-xs text-red-600 border-red-200">{error}</Card>
      )}

      {result && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <ImageIcon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-lg font-bold">{result.totalImages}</div>
                <div className="text-[10px] text-muted-foreground">Images</div>
              </div>
            </Card>
            <Card className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-600 flex items-center justify-center">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <div className="text-lg font-bold">{result.groups.length}</div>
                <div className="text-[10px] text-muted-foreground">Groups</div>
              </div>
            </Card>
            <Card className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-600 flex items-center justify-center">
                <Coins className="h-4 w-4" />
              </div>
              <div>
                <div className="text-lg font-bold">
                  {result.usage.totalCredits.toFixed(3)}
                </div>
                <div className="text-[10px] text-muted-foreground">Credits</div>
              </div>
            </Card>
            <Card className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-green-50 dark:bg-green-950/30 text-green-600 flex items-center justify-center">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <div className="text-lg font-bold">
                  {result.usage.totalTokens.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">Tokens</div>
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            {groupedItems.map(({ group, items }) => (
              <Card key={group.id} className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      {group.label}
                    </h2>
                    {group.description && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {group.description}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {items.length} image{items.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
                  {items.map((it) => (
                    <div
                      key={it.id}
                      className="relative aspect-square rounded-md overflow-hidden bg-muted"
                      title={`${it.filename}${
                        it.confidence != null
                          ? ` (${(it.confidence * 100).toFixed(0)}%)`
                          : ""
                      }`}
                    >
                      {thumbUrls[it.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumbUrls[it.id]}
                          alt={it.filename}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                          <ImageIcon className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

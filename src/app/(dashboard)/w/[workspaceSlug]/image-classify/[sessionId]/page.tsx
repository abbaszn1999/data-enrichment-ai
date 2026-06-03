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
  const header = ["Group Name", "SKU", "Image URL"];
  const rows = [header.join(",")];

  const escape = (raw: unknown) => {
    const s = String(raw ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  for (const g of result.groups) {
    const items = result.items.filter((it) => it.groupId === g.id);
    const urls = items.map((it) => it.url || fallbackUrls[it.id] || "").filter(Boolean);
    const skus = Array.from(new Set(items.map((it) => it.sku).filter(Boolean)));

    rows.push([
      escape(g.label),
      escape(skus.join("\n\n")),
      escape(urls.join("\n\n"))
    ].join(","));
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
  const [progress, setProgress] = useState(0);

  // Smooth real-time progress bar simulation
  useEffect(() => {
    if (session?.status !== "processing" && session?.status !== "pending") {
      if (session?.status === "completed") {
        setProgress(100);
      }
      return;
    }

    // Reset progress if it was completed or not started
    setProgress((prev) => (prev >= 100 ? 5 : prev || 5));

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev; // Hold at 95% until complete
        if (prev < 30) return prev + Math.random() * 8 + 4; // Fast start (0% - 30%)
        if (prev < 65) return prev + Math.random() * 4 + 2; // Medium pace (30% - 65%)
        if (prev < 85) return prev + Math.random() * 1.5 + 0.5; // Slow down (65% - 85%)
        return prev + Math.random() * 0.4 + 0.1; // Extremely slow close to the end (85% - 95%)
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.status]);

  const progressMessage = useMemo(() => {
    if (session?.status === "pending" || progress < 12) {
      return "Initializing classification session...";
    }
    if (progress < 35) {
      return "Downloading images and preparing AI model payload...";
    }
    if (progress < 60) {
      return "Analyzing visual features and extracting SKU codes...";
    }
    if (progress < 85) {
      return "AI is grouping matching products and identifying variants...";
    }
    if (progress < 95) {
      return "Structuring catalog details and compiling final metadata...";
    }
    return "Finishing up and saving results to database...";
  }, [progress, session?.status]);

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

  if (session.status === "pending" || session.status === "processing") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[85vh] px-4">
        <div className="flex flex-col items-center justify-center py-16 px-4 max-w-lg mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full">
          <Card className="w-full p-8 border border-primary/10 bg-card/60 backdrop-blur-md shadow-2xl rounded-2xl flex flex-col items-center text-center space-y-6 relative overflow-hidden">
            {/* Glowing decorative background elements */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-primary/10 rounded-full blur-3xl -z-10" />

            {/* Pulsing AI Circle */}
            <div className="relative flex items-center justify-center h-24 w-24">
              <div className="absolute inset-0 rounded-full bg-primary/5 animate-ping opacity-75 duration-1000" />
              <div className="absolute inset-2 rounded-full bg-primary/10 animate-pulse duration-1000" />
              <div className="relative h-16 w-16 rounded-full bg-gradient-to-tr from-primary via-blue-500 to-indigo-600 flex items-center justify-center text-primary-foreground shadow-xl">
                <Cpu className="h-8 w-8 animate-pulse" />
              </div>
            </div>

            <div className="space-y-2 w-full">
              <h3 className="text-xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text">
                Analyzing Product Images
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed h-10 flex items-center justify-center font-medium max-w-sm mx-auto">
                {progressMessage}
              </p>
            </div>

            {/* Progress Bar Container */}
            <div className="w-full space-y-3 px-2">
              <div className="flex justify-between items-center text-xs font-semibold px-1">
                <span className="text-primary font-mono text-sm bg-primary/10 px-2 py-0.5 rounded-full">{Math.round(progress)}%</span>
                <span className="text-muted-foreground font-medium animate-pulse">Running AI Agent...</span>
              </div>
              <div className="w-full h-3 bg-muted rounded-full overflow-hidden border border-muted/50 p-[1px]">
                <div
                  className="h-full bg-gradient-to-r from-primary via-blue-500 to-indigo-600 rounded-full transition-all duration-1000 ease-out shadow-inner"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Bottom Info */}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80 bg-muted/40 px-4 py-2 rounded-full border border-muted/50 font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>This page will update automatically</span>
              {polling && <span className="text-[10px] text-muted-foreground/60">· polling</span>}
            </div>
          </Card>
        </div>
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
            {groupedItems.map(({ group, items }) => {
              const uniqueSkus = Array.from(new Set(items.map((it) => it.sku).filter(Boolean)));
              return (
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
                    <div className="flex items-center gap-2 shrink-0">
                      {uniqueSkus.map((sku) => (
                        <Badge key={sku} variant="outline" className="text-[10px] bg-muted/40 font-mono text-primary font-semibold border-primary/20">
                          SKU: {sku}
                        </Badge>
                      ))}
                      <Badge variant="secondary" className="text-[10px]">
                        {items.length} image{items.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  </div>
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
                  {items.map((it) => (
                    <div key={it.id} className="flex flex-col gap-1 min-w-0">
                      <div
                        className="relative aspect-square rounded-md overflow-hidden bg-muted w-full"
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
                      <span
                        className="text-[9px] text-muted-foreground text-center truncate font-mono bg-muted/40 py-0.5 px-1 rounded border border-muted/50"
                        title={it.sku || "No SKU"}
                      >
                        {it.sku || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )})}
          </div>
        </>
      )}
    </div>
  );
}

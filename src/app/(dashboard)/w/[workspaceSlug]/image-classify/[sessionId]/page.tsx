"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Download,
  ImageIcon,
  Layers,
  AlertCircle,
  Coins,
  CheckCircle2,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/brand/page-loader";
import { Badge } from "@/components/ui/badge";
import {
  AnalyzingProductsCard,
  analyzingProgressMessage,
} from "@/components/media/analyzing-products-card";
import {
  imageCaption,
  sanitizeSku,
} from "@/lib/image-classify/sku";
import { useWorkspaceContext } from "../../workspace-context";
import { useWorkspaceStore } from "@/store/workspace-store";
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
  const header = ["Group Name", "SKU", "Filename", "Image URL"];
  const rows = [header.join(",")];

  const escape = (raw: unknown) => {
    const s = String(raw ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  for (const g of result.groups) {
    const items = result.items.filter((it) => it.groupId === g.id);
    for (const it of items) {
      rows.push(
        [
          escape(g.label),
          escape(sanitizeSku(it.sku, it.filename)),
          escape(it.filename),
          escape(it.url || fallbackUrls[it.id] || ""),
        ].join(",")
      );
    }
  }
  return rows.join("\n");
}

export default function ImageClassifyDetailPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const sessionId = params.sessionId as string;
  const { workspace } = useWorkspaceContext();
  const invalidateCredits = useWorkspaceStore((s) => s.invalidateCredits);

  const [session, setSession] = useState<ImageClassificationSession | null>(null);
  const [result, setResult] = useState<ImageClassificationJson | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [progress, setProgress] = useState(0);
  const wasProcessingRef = useRef(false);

  // Honest progress: unknown duration uses an indeterminate hold, not a fake climb.
  useEffect(() => {
    if (session?.status === "completed") {
      setProgress(100);
      return;
    }
    if (session?.status !== "processing" && session?.status !== "pending") {
      return;
    }
    setProgress(15);
  }, [session?.status]);

  const progressMessage = useMemo(
    () => analyzingProgressMessage(progress),
    [progress]
  );

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
        if (s?.status === "pending" || s?.status === "processing") {
          wasProcessingRef.current = true;
        }
        if (
          wasProcessingRef.current &&
          (s?.status === "completed" || s?.status === "failed")
        ) {
          wasProcessingRef.current = false;
          invalidateCredits();
        }
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
  }, [invalidateCredits, workspace, sessionId]);

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
    return <PageLoader />;
  }
  if (!session) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
        <div className="mx-auto max-w-7xl p-5 sm:p-6 lg:p-8">
          <div className="rounded-xl border bg-card px-6 py-16 text-center text-sm text-muted-foreground shadow-sm">
            Session not found.
          </div>
        </div>
      </div>
    );
  }

  if (session.status === "pending" || session.status === "processing") {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
        <AnalyzingProductsCard
          progress={progress}
          message={
            session.status === "pending" && progress < 12
              ? "Initializing classification session..."
              : progressMessage
          }
          showPolling={polling}
          stepLabel=""
        />
      </div>
    );
  }

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1500px] px-5 py-7 sm:px-7 lg:px-10">
        <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-xl border border-border/60 bg-background/70"
              asChild
            >
              <Link href={`/w/${slug}/image-classify`} aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#400095] text-white dark:bg-[#F76D01]">
                <Layers className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-[9px] font-black uppercase tracking-[.2em] text-[#400095] dark:text-[#F76D01]">Classification result</div>
                <h1 className="truncate text-3xl font-black tracking-[-.035em]">
                  {session.name}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${
                      session.status === "completed"
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                        : session.status === "failed"
                          ? "border-destructive/30 bg-destructive/5 text-destructive"
                          : ""
                    }`}
                  >
                    {session.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {session.total_images} images · {session.group_count} groups
                  </span>
                </div>
              </div>
            </div>
          </div>

          {result && (
            <div className="flex items-center gap-2 self-start">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleExport("csv")}
                className="h-9 gap-1.5 rounded-xl border-border/60 bg-background/70 text-xs"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button
                size="sm"
                onClick={() => handleExport("json")}
                className="h-9 gap-1.5 rounded-xl bg-[#400095] px-4 text-xs text-white hover:bg-[#6B358D] dark:bg-[#F76D01]"
              >
                <Download className="h-3.5 w-3.5" /> JSON
              </Button>
            </div>
          )}
        </motion.header>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-6 p-5 sm:p-7 lg:p-10">

        {session.status === "failed" && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">
              {session.error_message || "Classification failed."}
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
            {error}
          </div>
        )}

        {result && (
          <>
            <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm lg:grid-cols-4">
              {[
                {
                  label: "Images",
                  value: result.totalImages,
                  icon: ImageIcon,
                },
                {
                  label: "Groups",
                  value: result.groups.length,
                  icon: Layers,
                },
                {
                  label: "Credits",
                  value: result.usage.totalCredits.toFixed(3),
                  icon: Coins,
                },
                {
                  label: "Tokens",
                  value: result.usage.totalTokens.toLocaleString(),
                  icon: Cpu,
                },
              ].map((stat) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 border-r border-border/60 px-4 py-4 last:border-r-0"
                >
                    <stat.icon className="h-4 w-4 text-[#6B358D] dark:text-[#C8A8D2]" />
                  <div>
                    <p className="text-lg font-black leading-none">{stat.value}</p>
                    <p className="mt-1 text-[8px] font-bold uppercase tracking-[.16em] text-muted-foreground">
                      {stat.label}
                    </p>
                  </div>
                </motion.div>
              ))}
            </section>

            <div className="space-y-4">
              {groupedItems.map(({ group, items }) => {
                const uniqueSkus = Array.from(
                  new Set(
                    items
                      .map((it) => sanitizeSku(it.sku, it.filename))
                      .filter(Boolean)
                  )
                );
                return (
                  <article
                    key={group.id}
                    className="group overflow-hidden rounded-[24px] border border-border/60 bg-card shadow-[0_15px_50px_rgba(15,23,42,.05)]"
                  >
                    <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
                    <div className="space-y-3 border-b bg-gradient-to-r from-[#400095]/[0.04] to-[#F76D01]/[0.04] p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h2 className="flex items-start gap-2 text-sm font-semibold">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <span className="break-words">{group.label}</span>
                          </h2>
                          {group.description ? (
                            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
                              {group.description}
                            </p>
                          ) : null}
                        </div>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {items.length} image{items.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      {uniqueSkus.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {uniqueSkus.map((sku) => (
                            <Badge
                              key={sku}
                              variant="outline"
                              className="max-w-full break-all border-[#6B358D]/25 font-mono text-[10px] font-semibold text-[#6B358D] dark:text-[#C8A8D2]"
                            >
                              SKU: {sku}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                      {items.map((it) => {
                        const caption = imageCaption(it.sku, it.filename);
                        return (
                          <div key={it.id} className="min-w-0 space-y-1.5">
                            <div
                              className="relative aspect-square overflow-hidden rounded-xl border border-border/60 bg-muted shadow-sm transition-all group-hover:shadow-md"
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
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                                  <ImageIcon className="h-4 w-4" />
                                </div>
                              )}
                            </div>
                            <p
                              className="break-words text-center text-[10px] leading-snug text-muted-foreground"
                              title={
                                caption.isSku
                                  ? `SKU: ${caption.primary}`
                                  : it.filename
                              }
                            >
                              {caption.isSku ? (
                                <span className="font-mono font-medium text-foreground">
                                  {caption.primary}
                                </span>
                              ) : (
                                caption.primary
                              )}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

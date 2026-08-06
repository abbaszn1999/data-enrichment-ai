"use client";

import { Cpu, Loader2, Upload } from "lucide-react";

export function analyzingProgressMessage(progress: number): string {
  if (progress < 12) return "Initializing classification session...";
  if (progress < 35) return "Downloading images and preparing AI model payload...";
  if (progress < 60) return "Analyzing visual features and extracting SKU codes...";
  if (progress < 85)
    return "AI is grouping matching products and identifying variants...";
  if (progress < 95)
    return "Structuring catalog details and compiling final metadata...";
  return "Finishing up and saving results to database...";
}

export function UploadingImagesCard({
  percent,
  done,
  total,
  preparing,
}: {
  percent: number;
  done: number;
  total: number;
  preparing?: boolean;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="animate-in fade-in slide-in-from-bottom-4 relative w-full max-w-lg overflow-hidden rounded-2xl border border-primary/10 bg-card/60 p-8 text-center shadow-2xl backdrop-blur-md duration-500">
        <div className="absolute left-1/2 top-0 -z-10 h-32 w-32 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/5 opacity-75 duration-1000" />
          <div className="absolute inset-2 animate-pulse rounded-full bg-primary/10 duration-1000" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-primary via-blue-500 to-indigo-600 text-primary-foreground shadow-xl">
            <Upload className="h-7 w-7" />
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            Step 1 of 2 · Upload
          </p>
          <h3 className="text-xl font-bold tracking-tight">Uploading images</h3>
          <p className="mx-auto max-w-sm text-xs font-medium leading-relaxed text-muted-foreground">
            {preparing
              ? "Preparing thumbnails before secure upload…"
              : "Your thumbnails are being uploaded securely to workspace storage."}
          </p>
        </div>

        <div className="mt-8 w-full space-y-3 px-2">
          <div className="flex items-center justify-between px-1 text-xs font-semibold">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-sm text-primary">
              {Math.round(percent)}%
            </span>
            <span className="animate-pulse font-medium text-muted-foreground">
              {preparing
                ? "Preparing…"
                : `Uploaded ${done}/${total} images`}
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full border border-muted/50 bg-muted p-[1px]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-blue-500 to-indigo-600 transition-all duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>
        </div>

        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-muted/50 bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground/80">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Please keep this page open</span>
        </div>
      </div>
    </div>
  );
}

export function AnalyzingProductsCard({
  progress,
  message,
  statusLabel = "Running AI Agent...",
  footerNote = "This page will update automatically",
  showPolling = false,
  stepLabel = "Step 2 of 2 · Analyzing",
}: {
  progress: number;
  message: string;
  statusLabel?: string;
  footerNote?: string;
  showPolling?: boolean;
  stepLabel?: string;
}) {
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="animate-in fade-in slide-in-from-bottom-4 relative w-full max-w-lg overflow-hidden rounded-2xl border border-primary/10 bg-card/60 p-8 text-center shadow-2xl backdrop-blur-md duration-500">
        <div className="absolute left-1/2 top-0 -z-10 h-32 w-32 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full bg-primary/5 opacity-75 duration-1000" />
          <div className="absolute inset-2 animate-pulse rounded-full bg-primary/10 duration-1000" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-tr from-primary via-blue-500 to-indigo-600 text-primary-foreground shadow-xl">
            <Cpu className="h-8 w-8 animate-pulse" />
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {stepLabel ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              {stepLabel}
            </p>
          ) : null}
          <h3 className="bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-xl font-bold tracking-tight">
            Analyzing Product Images
          </h3>
          <p className="mx-auto flex h-10 max-w-sm items-center justify-center text-xs font-medium leading-relaxed text-muted-foreground">
            {message}
          </p>
        </div>

        <div className="mt-8 w-full space-y-3 px-2">
          <div className="flex items-center justify-between px-1 text-xs font-semibold">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-sm text-primary">
              {Math.round(clamped)}%
            </span>
            <span className="animate-pulse font-medium text-muted-foreground">
              {statusLabel}
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full border border-muted/50 bg-muted p-[1px]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-blue-500 to-indigo-600 shadow-inner transition-all duration-1000 ease-out"
              style={{ width: `${clamped}%` }}
            />
          </div>
        </div>

        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-muted/50 bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground/80">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>{footerNote}</span>
          {showPolling ? (
            <span className="text-[10px] text-muted-foreground/60">· polling</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

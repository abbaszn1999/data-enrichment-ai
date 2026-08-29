"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Plus,
  Upload,
  X,
  ImageIcon,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/brand/page-loader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AnalyzingProductsCard,
  UploadingImagesCard,
  analyzingProgressMessage,
} from "@/components/media/analyzing-products-card";
import { useWorkspaceContext } from "../../workspace-context";
import { useRole } from "@/hooks/use-role";
import {
  createImageClassificationSession,
  updateImageClassificationSession,
} from "@/lib/supabase";
import {
  uploadImageToStorage,
  getImageClassificationImagesPrefix,
  getImageClassificationImagePath,
} from "@/lib/storage-helpers";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const MAX_IMAGES = 200;
// Max bytes per image after thumbnailing (we re-encode to JPEG ≤1024px).
const MAX_BYTES = 1.5 * 1024 * 1024;

type LocalImage = {
  id: string;
  file: File;
  thumbnail: Blob;
  thumbnailUrl: string;
  filename: string;
};

async function thumbnailImage(file: File, maxDim = 1024): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas context unavailable");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) reject(new Error("Failed to encode thumbnail"));
            else resolve(blob);
          },
          "image/jpeg",
          0.85
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

export default function NewImageClassifyPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.workspaceSlug as string;
  const { workspace, role, wsLoading } = useWorkspaceContext();
  const permissions = useRole(role);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<
    "minimal" | "low" | "medium" | "high"
  >("medium");
  const [images, setImages] = useState<LocalImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "preparing" | "uploading" | "classifying"
  >("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState(8);

  useEffect(() => {
    if (phase !== "classifying") {
      setAnalyzeProgress(8);
      return;
    }
    const interval = setInterval(() => {
      setAnalyzeProgress((prev) => {
        if (prev >= 95) return prev;
        if (prev < 30) return prev + Math.random() * 8 + 4;
        if (prev < 65) return prev + Math.random() * 4 + 2;
        if (prev < 85) return prev + Math.random() * 1.5 + 0.5;
        return prev + Math.random() * 0.4 + 0.1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) =>
        ACCEPTED_TYPES.includes(f.type)
      );
      if (arr.length === 0) {
        setError("No supported image files (jpg, png, webp, gif).");
        return;
      }
      setError(null);
      setPhase("preparing");
      const next: LocalImage[] = [];
      for (const file of arr) {
        if (images.length + next.length >= MAX_IMAGES) break;
        try {
          const thumb = await thumbnailImage(file);
          next.push({
            id: crypto.randomUUID(),
            file,
            thumbnail: thumb,
            thumbnailUrl: URL.createObjectURL(thumb),
            filename: file.name,
          });
        } catch (err) {
          console.warn("Failed to thumbnail", file.name, err);
        }
      }
      setImages((prev) => [...prev, ...next]);
      setPhase("idle");
    },
    [images.length]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.thumbnailUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const canSubmit =
    !!workspace &&
    name.trim().length > 0 &&
    images.length > 0 &&
    phase === "idle" &&
    permissions.canImport;

  const handleSubmit = async () => {
    if (!workspace || !canSubmit) return;
    setError(null);
    let sessionId: string | null = null;
    try {
      const session = await createImageClassificationSession(workspace.id, {
        name: name.trim(),
        notes: instruction.trim(),
        total_images: images.length,
      });
      sessionId = session.id;

      setPhase("uploading");
      setProgress({ done: 0, total: images.length });
      const uploaded: Array<{
        id: string;
        filename: string;
        storagePath: string;
        mimeType: string;
      }> = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.thumbnail.size > MAX_BYTES) {
          throw new Error(
            `Thumbnail for "${img.filename}" is too large after resize`
          );
        }
        const storagePath = getImageClassificationImagePath(
          workspace.id,
          session.id,
          img.id,
          "jpg"
        );
        await uploadImageToStorage(storagePath, img.thumbnail);
        uploaded.push({
          id: img.id,
          filename: img.filename,
          storagePath,
          mimeType: "image/jpeg",
        });
        setProgress({ done: i + 1, total: images.length });
      }

      const imagesPrefix = getImageClassificationImagesPrefix(
        workspace.id,
        session.id
      );
      await updateImageClassificationSession(session.id, {
        images_prefix: imagesPrefix,
      });

      setPhase("classifying");
      const res = await fetch("/api/image-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          sessionId: session.id,
          images: uploaded,
          instruction: instruction.trim() || undefined,
          thinkingLevel,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Classification failed (${res.status})`);
      }

      router.push(`/w/${slug}/image-classify/${session.id}`);
    } catch (err) {
      const msg = (err as Error).message || "Failed to start classification";
      setError(msg);
      setPhase("idle");
      if (sessionId) {
        await updateImageClassificationSession(sessionId, {
          status: "failed",
          error_message: msg,
        }).catch(() => {});
      }
    }
  };

  const busy = phase !== "idle";
  const uploadPercent =
    progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : phase === "preparing"
        ? 5
        : 0;

  if (wsLoading) {
    return <PageLoader />;
  }

  if (!permissions.canImport) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
        <div className="mx-auto max-w-7xl p-5 sm:p-6 lg:p-8">
          <div className="rounded-xl border bg-card px-6 py-16 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">
              You do not have permission to create classifications.
            </p>
            <Button size="sm" variant="outline" className="mt-4" asChild>
              <Link href={`/w/${slug}/image-classify`}>Back to projects</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      {phase === "preparing" || phase === "uploading" ? (
        <UploadingImagesCard
          percent={uploadPercent}
          done={progress.done}
          total={progress.total || images.length}
          preparing={phase === "preparing"}
        />
      ) : phase === "classifying" ? (
        <AnalyzingProductsCard
          progress={analyzeProgress}
          message={analyzingProgressMessage(analyzeProgress)}
          footerNote="Please keep this page open · redirecting when ready"
        />
      ) : (
      <>
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1500px] px-5 py-7 sm:px-7 lg:px-10">
        <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
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
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white dark:bg-[#F76D01]"><Sparkles className="h-4 w-4" /></span>
                <span className="text-[9px] font-black uppercase tracking-[.22em] text-[#400095] dark:text-[#F76D01]">Multimodal intake</span>
              </div>
                <h1 className="text-3xl font-black tracking-[-.035em]">
                  New Image Classification
                </h1>
                <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                  Prepare a visual batch, guide the grouping logic, and send every image through one coordinated multimodal analysis.
                </p>
            </div>
          </div>
        </motion.header>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-5 p-5 sm:p-7 lg:p-10">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <section className="overflow-hidden rounded-[24px] border border-border/60 bg-card shadow-[0_15px_50px_rgba(15,23,42,.05)]">
              <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
              <div className="border-b bg-muted/20 px-5 py-4">
                <h2 className="text-sm font-semibold">Project details</h2>
                <p className="text-[11px] text-muted-foreground">
                  Name the project and optionally guide how images should be
                  grouped.
                </p>
              </div>
              <div className="space-y-4 p-5">
                <div className="space-y-1.5">
                  <Label htmlFor="classify-session-name" className="text-xs">
                    Session name
                  </Label>
                  <Input
                    id="classify-session-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. New supplier batch — May"
                    disabled={busy}
                    maxLength={120}
                    className="h-10 rounded-xl bg-muted/35"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="classify-instruction" className="text-xs">
                    Custom instruction
                  </Label>
                  <textarea
                    id="classify-instruction"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="e.g. Follow the customer's notes: group by brand first, keep damaged packaging separate, or use specific group names."
                    disabled={busy}
                    rows={3}
                    className="w-full resize-none rounded-xl border border-border/60 bg-muted/35 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#6B358D]/40 disabled:opacity-60"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="classify-thinking" className="text-xs">
                    Thinking level
                  </Label>
                  <select
                    id="classify-thinking"
                    value={thinkingLevel}
                    onChange={(e) =>
                      setThinkingLevel(e.target.value as typeof thinkingLevel)
                    }
                    disabled={busy}
                    className="h-10 w-full rounded-xl border border-border/60 bg-muted/35 px-3 text-sm outline-none focus:ring-1 focus:ring-[#6B358D]/40 disabled:opacity-60"
                  >
                    <option value="minimal">
                      Minimal — fastest, lowest cost
                    </option>
                    <option value="low">Low — quick grouping</option>
                    <option value="medium">
                      Medium — balanced (default)
                    </option>
                    <option value="high">
                      High — deepest reasoning, best accuracy
                    </option>
                  </select>
                </div>
              </div>
            </section>

            <section
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={busy ? undefined : handleDrop}
              className={`overflow-hidden rounded-[24px] border bg-card shadow-sm transition-colors ${
                isDragging ? "border-[#400095] ring-1 ring-[#400095]/30 dark:border-[#F76D01]" : ""
              }`}
            >
              <div className="border-b bg-muted/20 px-5 py-4">
                <h2 className="text-sm font-semibold">Product images</h2>
                <p className="text-[11px] text-muted-foreground">
                  JPG / PNG / WebP / GIF — max {MAX_IMAGES} images. Auto-resized
                  to 1024px before upload.
                </p>
              </div>

              <div className="p-5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(",")}
                  multiple
                  disabled={busy}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />

                {images.length === 0 ? (
                  <div
                    className={`flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
                      isDragging
                        ? "border-[#400095] bg-[#400095]/5 dark:border-[#F76D01] dark:bg-[#F76D01]/5"
                        : "border-muted-foreground/20 bg-muted/10"
                    }`}
                  >
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F76D01]/15 to-[#400095]/15">
                      <Upload className="h-6 w-6 text-[#6B358D]" />
                    </div>
                    <p className="text-sm font-medium">
                      Drop product images here, or click to browse
                    </p>
                    <p className="mt-1 max-w-sm text-[11px] text-muted-foreground">
                      Select a batch of product photos to classify into groups
                      with AI.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-5"
                      disabled={busy}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose images
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 xl:grid-cols-10">
                    {images.map((img) => (
                      <div
                        key={img.id}
                        className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.thumbnailUrl}
                          alt={img.filename}
                          className="h-full w-full object-cover"
                        />
                        {!busy && (
                          <button
                            type="button"
                            onClick={() => removeImage(img.id)}
                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                            title="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    {!busy && images.length < MAX_IMAGES && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                        title="Add more images"
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-[#6B358D]/20 bg-gradient-to-br from-[#400095]/[0.06] to-[#F76D01]/[0.04] p-5">
              <div className="text-[9px] font-black uppercase tracking-[.18em] text-[#6B358D] dark:text-[#C8A8D2]">Batch readiness</div>
              <div className="mt-3 text-3xl font-black tabular-nums">{images.length}<span className="ml-1 text-sm text-muted-foreground">/ {MAX_IMAGES}</span></div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Images are resized locally to protect speed and reduce processing cost before upload.</p>
            </section>
            <section className="rounded-2xl border border-border/60 bg-card p-5">
              <h3 className="text-xs font-black">How this run works</h3>
              <ol className="mt-3 space-y-3 text-[10px] text-muted-foreground">
                <li><strong className="text-foreground">01.</strong> Prepare and resize the selected images.</li>
                <li><strong className="text-foreground">02.</strong> Upload the optimized visual batch.</li>
                <li><strong className="text-foreground">03.</strong> Classify everything in one multimodal request.</li>
              </ol>
            </section>
          </aside>
        </motion.div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            {images.length} image{images.length === 1 ? "" : "s"} ready
          </div>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="h-10 gap-1.5 self-stretch rounded-xl bg-[#400095] px-5 text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] sm:self-auto"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Classify images
          </Button>
        </div>
      </main>
      </>
      )}
    </div>
  );
}

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AnalyzingProductsCard,
  UploadingImagesCard,
  analyzingProgressMessage,
} from "@/components/media/analyzing-products-card";
import { useWorkspaceContext } from "../../layout";
import { useRole } from "@/hooks/use-role";
import { useWorkspaceStore } from "@/store/workspace-store";
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
  const { workspace, role } = useWorkspaceContext();
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

      useWorkspaceStore.getState().invalidateCredits();
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
    <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
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
      <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl border bg-background shadow-sm"
              asChild
            >
              <Link href={`/w/${slug}/image-classify`} aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">
                  New Image Classification
                </h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  All images are sent to AI in a single multimodal request.
                </p>
              </div>
            </div>
          </div>
        </header>

            <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
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
                    className="h-9"
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
                    className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
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
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
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
              className={`overflow-hidden rounded-xl border bg-card shadow-sm transition-colors ${
                isDragging ? "border-primary ring-1 ring-primary/30" : ""
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
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/20 bg-muted/10"
                    }`}
                  >
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Upload className="h-5 w-5" />
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

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            {images.length} image{images.length === 1 ? "" : "s"} ready
          </div>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="gap-1.5 self-stretch sm:self-auto"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Classify images
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

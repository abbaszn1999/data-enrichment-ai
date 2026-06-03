"use client";

import { useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Upload,
  X,
  Loader2,
  ImageIcon,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useWorkspaceContext } from "../../layout";
import { useRole } from "@/hooks/use-role";
import { useWorkspaceStore } from "@/store/workspace-store";
import {
  createImageClassificationSession,
  updateImageClassificationSession,
} from "@/lib/supabase";
import { createClient as createBrowserClient } from "@/lib/supabase-browser";
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
  const [thinkingLevel, setThinkingLevel] = useState<"minimal" | "low" | "medium" | "high">("medium");
  const [images, setImages] = useState<LocalImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "preparing" | "uploading" | "classifying"
  >("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => ACCEPTED_TYPES.includes(f.type));
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
  }, [images.length]);

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
      // 1. Create session row
      const session = await createImageClassificationSession(workspace.id, {
        name: name.trim(),
        notes: instruction.trim(),
        total_images: images.length,
      });
      sessionId = session.id;

      // 2. Upload thumbnails
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

      // 3. Trigger classification
      setPhase("classifying");
      const supabase = createBrowserClient();
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      if (!authSession?.access_token) {
        throw new Error("Not authenticated");
      }

      const functionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/image-classify`;
      const res = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authSession.access_token}`,
        },
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

  if (!permissions.canImport) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            You do not have permission to create classifications.
          </p>
        </Card>
      </div>
    );
  }

  const busy = phase !== "idle";
  const stepNumber = phase === "classifying" ? 2 : 1;
  const uploadPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href={`/w/${slug}/image-classify`}
          className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> New Image Classification
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            All images are sent to AI in a single multimodal request.
          </p>
        </div>
      </div>

      {busy ? (
        <Card className="p-8 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold text-primary">
                Step {stepNumber}/2
              </p>
              <h2 className="text-lg font-bold mt-1">
                {phase === "classifying"
                  ? "Classifying images"
                  : "Uploading images"}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {phase === "classifying"
                  ? "Your images were uploaded successfully. The AI model is now grouping them by the provided custom instruction."
                  : "Your thumbnails are being prepared and uploaded securely to workspace storage."}
              </p>
            </div>
            <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-xl border p-4 ${phase === "uploading" || phase === "preparing" ? "border-primary bg-primary/5" : "border-green-500/30 bg-green-500/5"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">1/2 Upload images</span>
                {phase === "classifying" ? (
                  <span className="text-[10px] text-green-600 font-medium">Done</span>
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: phase === "classifying" ? "100%" : `${uploadPercent}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                {phase === "preparing"
                  ? "Preparing thumbnails…"
                  : phase === "uploading"
                    ? `Uploaded ${progress.done}/${progress.total} images`
                    : `${images.length} images uploaded`}
              </p>
            </div>

            <div className={`rounded-xl border p-4 ${phase === "classifying" ? "border-primary bg-primary/5" : "border-muted"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">2/2 Classification</span>
                {phase === "classifying" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full bg-primary transition-all ${phase === "classifying" ? "w-2/3 animate-pulse" : "w-0"}`}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                {phase === "classifying"
                  ? "The AI model is analyzing and grouping your product images…"
                  : "Starts automatically after upload is complete"}
              </p>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Please keep this page open. You will be redirected to the result page automatically.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Session name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. New supplier batch — May"
                disabled={busy}
                className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Custom instruction
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. Follow the customer's notes: group by brand first, keep damaged packaging separate, or use specific group names."
                disabled={busy}
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60 resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Thinking level</label>
              <select
                value={thinkingLevel}
                onChange={(e) =>
                  setThinkingLevel(e.target.value as typeof thinkingLevel)
                }
                disabled={busy}
                className="w-full h-9 px-3 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
              >
                <option value="minimal">Minimal — fastest, lowest cost</option>
                <option value="low">Low — quick grouping</option>
                <option value="medium">Medium — balanced (default)</option>
                <option value="high">High — deepest reasoning, best accuracy</option>
              </select>
            </div>
          </Card>

          <Card
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={busy ? undefined : handleDrop}
            className={`p-6 border-2 border-dashed transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/20"
            }`}
          >
            {images.length === 0 && (
              <div className="flex flex-col items-center text-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">
                  Drop product images here, or click to browse
                </p>
                <p className="text-[11px] text-muted-foreground">
                  JPG / PNG / WebP / GIF — max {MAX_IMAGES} images. They are auto-resized to 1024px before upload.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose images
                </Button>
              </div>
            )}

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

            {images.length > 0 && (
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="relative aspect-square rounded-md overflow-hidden bg-muted group"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.thumbnailUrl}
                      alt={img.filename}
                      className="w-full h-full object-cover"
                    />
                    {!busy && (
                      <button
                        onClick={() => removeImage(img.id)}
                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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
                    className="aspect-square rounded-md border border-dashed border-muted-foreground/30 bg-white text-black hover:bg-muted flex items-center justify-center transition-colors"
                    title="Add more images"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {error && (
        <Card className="p-3 border-red-200 bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        </Card>
      )}

      {!busy && (
      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <ImageIcon className="h-3.5 w-3.5" />
          {images.length} image{images.length === 1 ? "" : "s"} ready
        </div>
        <Button
          size="sm"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="gap-1.5"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {busy ? "Working…" : "Classify images"}
        </Button>
      </div>
      )}
    </div>
  );
}

"use client";

/** Minimal read-only image viewer: click a thumbnail, then switch between a
 * row's images with the arrow buttons or the left/right arrow keys. */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function ImageLightbox({
  images,
  startIndex,
  title,
  onClose,
}: {
  images: string[];
  startIndex: number;
  title: string;
  onClose: () => void;
}) {
  // The parent only mounts this dialog once an image is clicked and fully
  // unmounts it on close, so `startIndex` is a fresh initial value each time.
  const [index, setIndex] = useState(startIndex);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [images.length]);

  if (images.length === 0) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[85vh] max-w-4xl flex-col items-center justify-center bg-background/95 p-4"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full bg-background/80 p-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="relative flex h-full w-full items-center justify-center">
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}
              className="absolute left-2 z-10 rounded-full bg-background/80 p-2 shadow hover:bg-background"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[index]}
            alt={title}
            className="max-h-full max-w-full rounded-md object-contain"
          />
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % images.length)}
              className="absolute right-2 z-10 rounded-full bg-background/80 p-2 shadow hover:bg-background"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>
        {images.length > 1 && (
          <p className="pt-2 text-xs text-muted-foreground">
            {index + 1} / {images.length}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

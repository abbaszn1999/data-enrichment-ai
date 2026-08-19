"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

type NewProjectOverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void | Promise<void>;
  /** First-run: no close — naming is required to enter. */
  required?: boolean;
  storeLabel?: string;
};

/**
 * Contained naming screen — fills the shell content area under the app/header
 * chrome (not a viewport portal).
 */
export function NewProjectOverlay({
  open,
  onOpenChange,
  onCreate,
  required = false,
  storeLabel = "your connected store",
}: NewProjectOverlayProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();

  useEffect(() => {
    if (!open) {
      setName("");
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !required) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, required]);

  if (!open) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    onCreate(trimmed);
    onOpenChange(false);
  };

  return (
    <div
      className={cn(
        "absolute inset-0 z-20 flex flex-col overflow-hidden bg-background",
        "animate-in fade-in-0 duration-300"
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${formId}-title`}
      aria-describedby={`${formId}-desc`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.55] dark:opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--foreground) 12%, transparent) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.06] via-transparent to-background/80" />

      {!required ? (
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute top-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
          <Search className="h-6 w-6" />
        </div>

        <h1
          id={`${formId}-title`}
          className="mb-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Name your research project
        </h1>
        <p
          id={`${formId}-desc`}
          className="mb-8 max-w-md text-center text-sm text-muted-foreground leading-relaxed"
        >
          Give this run a clear name. Next, the agent will map the website scope
          on{" "}
          <span className="font-medium text-foreground/80">{storeLabel}</span> —
          what already exists, before any recommendations.
        </p>

        <form
          id={formId}
          className="w-full max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="sr-only" htmlFor={`${formId}-name`}>
            Project name
          </label>
          <div className="flex items-center gap-2 rounded-2xl border border-border/80 bg-card/95 px-3 py-2 shadow-md backdrop-blur-sm transition-shadow focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
            <input
              ref={inputRef}
              id={`${formId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Eyewear scope — Q3"
              maxLength={80}
              className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-all hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
              aria-label="Continue"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                After naming, the agent starts a first website read (~12s
                preview).
              </p>
        </form>
      </div>
    </div>
  );
}

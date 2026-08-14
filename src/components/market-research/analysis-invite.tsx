"use client";

import { Play, Store } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AnalysisInviteProps = {
  open: boolean;
  storeLabel: string;
  projectName: string;
  onRun: () => void;
  onDismiss: () => void;
};

/** Consent gate before Stage 1 boot — plan & approve, then Run. */
export function AnalysisInvite({
  open,
  storeLabel,
  projectName,
  onRun,
  onDismiss,
}: AnalysisInviteProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-background/70 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-300"
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-300"
          )}
        >
          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xl space-y-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1.5">
              <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
                Start website scope analysis?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground leading-relaxed">
                For{" "}
                <span className="font-medium text-foreground">{projectName}</span>, the
                agent will read{" "}
                <span className="font-medium text-foreground">{storeLabel}</span> and
                tell you what broad niches the site appears to sell — in plain
                language, without categories or product counts yet.
              </DialogPrimitive.Description>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-1">
              <Button type="button" variant="outline" onClick={onDismiss}>
                Not now
              </Button>
              <Button type="button" className="gap-2" onClick={onRun}>
                <Play className="h-3.5 w-3.5 fill-current" />
                Run analysis
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

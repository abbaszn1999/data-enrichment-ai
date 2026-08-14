"use client";

import { LayoutTemplate } from "lucide-react";

/**
 * Website restructure — Growth engine module.
 * Placeholder shell; full UI lands in this file (and siblings) as the module grows.
 */
export default function WebsiteRestructurePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
        <LayoutTemplate className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Website restructure</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This module is coming soon.
        </p>
      </div>
    </div>
  );
}

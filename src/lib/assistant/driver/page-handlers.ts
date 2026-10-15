"use client";

import { useEffect, useRef } from "react";

/**
 * Pages whose state lives in local React state (not a shared store) register
 * these handlers so the assistant can read the page and select rows. Only
 * the page that is currently mounted is registered.
 */

export type PageScope = "gallery" | "visualizer";

export type PageSelectRows = {
  mode: "all" | "none" | "indexes" | "status";
  indexes?: number[];
  statuses?: string[];
};

export type EstimateFeature = "catalog" | "gallery_ai" | "gallery_google" | "visualizer";

export type PageEstimate = { feature: EstimateFeature; rows: number };

export interface PageHandlers {
  getState: () => unknown;
  selectRows: (args: PageSelectRows) => unknown;
  /** Replace the page's chosen input columns (by header name). */
  setColumns?: (columns: string[]) => unknown;
  /** What the credit-spending control would run, for the confirmation card's estimate. */
  estimate?: () => PageEstimate | null;
}

const registry = new Map<PageScope, PageHandlers>();

export function getPageHandlers(scope: PageScope): PageHandlers | undefined {
  return registry.get(scope);
}

/** Register handlers for the lifetime of the calling component. The latest closures are always used. */
export function usePageAgentHandlers(scope: PageScope, handlers: PageHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const stable: PageHandlers = {
      getState: () => ref.current.getState(),
      selectRows: (args) => ref.current.selectRows(args),
      setColumns: (columns) => {
        if (!ref.current.setColumns) throw new Error("This page has no column choice.");
        return ref.current.setColumns(columns);
      },
      estimate: () => ref.current.estimate?.() ?? null,
    };
    registry.set(scope, stable);
    return () => {
      if (registry.get(scope) === stable) registry.delete(scope);
    };
  }, [scope]);
}

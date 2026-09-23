"use client";

import { useCallback, useEffect, useState } from "react";
import type React from "react";

/** Row height/line math shared by sheet rows and clamped text cells. */
export const DEFAULT_ROW_HEIGHT = 64;
export const MIN_ROW_HEIGHT = 32;
export const MAX_ROW_HEIGHT = 640;
export const CELL_LINE_HEIGHT = 16;
export const CELL_PADDING_Y = 16;

export function rowLinesFor(height: number): number {
  return Math.max(1, Math.floor((height - CELL_PADDING_Y) / CELL_LINE_HEIGHT));
}

export function clampRowHeight(height: number): number {
  return Math.round(Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, height)));
}

/** Clamps cell text to the number of lines the row height allows (`--row-lines`). */
export const CLAMPED_TEXT_STYLE: React.CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: "var(--row-lines, 3)",
  overflow: "hidden",
};

/** Keeps table-cell content inside the row height (cells use 8px top + bottom padding). */
export const CELL_BOX_STYLE: React.CSSProperties = {
  maxHeight: "calc(var(--row-h) - 16px)",
  overflow: "hidden",
};

export type SizeMap = Record<string, number>;
export type SheetScope = "catalog" | "gallery" | "visualizer";
type SizeKind = "row-heights" | "column-sizes";

function sizeStorageKey(scope: SheetScope, kind: SizeKind, projectId: string | null) {
  return projectId ? `${scope}-${kind}:${projectId}` : null;
}

function readSizeMap(key: string | null): SizeMap {
  if (!key || typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSizeMap(key: string | null, map: SizeMap) {
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // Storage full or unavailable — sizes just won't persist.
  }
}

/** Sheet sizes (row heights / column widths) remembered per project in localStorage. */
export function useProjectSizeMap(
  scope: SheetScope,
  kind: SizeKind,
  projectId: string | null
) {
  const [state, setState] = useState(() => ({
    projectId,
    map: readSizeMap(sizeStorageKey(scope, kind, projectId)),
  }));
  if (state.projectId !== projectId) {
    setState({ projectId, map: readSizeMap(sizeStorageKey(scope, kind, projectId)) });
  }
  useEffect(() => {
    writeSizeMap(sizeStorageKey(scope, kind, state.projectId), state.map);
  }, [scope, kind, state]);
  const update = useCallback((updater: (map: SizeMap) => SizeMap) => {
    setState((current) => ({ ...current, map: updater(current.map) }));
  }, []);
  return [state.map, update] as const;
}

/**
 * Tracks a resize drag from pointerdown until release. Listens on window with
 * pointer capture, and also ends when the button is found released, capture is
 * lost, or the window blurs — so a swallowed pointerup can never leave the
 * handle stuck to the mouse.
 */
export function trackPointerDrag(
  event: React.PointerEvent<HTMLElement>,
  cursor: string,
  handlers: { onMove: (dx: number, dy: number) => void; onEnd: () => void }
) {
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const { pointerId, clientX: startX, clientY: startY } = event;
  let ended = false;

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (e.buttons === 0) {
      end();
      return;
    }
    handlers.onMove(e.clientX - startX, e.clientY - startY);
  };
  const end = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", end);
    handle.removeEventListener("lostpointercapture", end);
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    handlers.onEnd();
  };

  try {
    handle.setPointerCapture(pointerId);
  } catch {
    // Pointer already gone; window listeners still cover the drag.
  }
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("blur", end);
  handle.addEventListener("lostpointercapture", end);
}

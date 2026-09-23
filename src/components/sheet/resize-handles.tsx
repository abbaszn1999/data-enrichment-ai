"use client";

import type React from "react";

/** Right-edge column resize grip for a header cell (the cell must be positioned). */
export function ColumnResizeHandle({
  onPointerDown,
  onReset,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onReset: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      title="Drag to resize column · double-click to reset"
      draggable={false}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      onClick={(e) => e.stopPropagation()}
      className="group/resize absolute right-0 top-0 z-10 flex h-full w-2.5 cursor-col-resize touch-none select-none justify-end"
    >
      <span className="h-full w-0.5 bg-transparent group-hover/resize:bg-primary/60 group-active/resize:bg-primary" />
    </div>
  );
}

/**
 * Bottom-edge row resize grip, like Google Sheets: it lives only in the
 * row-number/checkbox column, so hovering data cells never shows it.
 * The host cell must be positioned.
 */
export function RowResizeHandle({
  onPointerDown,
  onReset,
}: {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onReset: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize row"
      title="Drag to resize row · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-row-resize touch-none hover:bg-primary/50 active:bg-primary/80"
    />
  );
}

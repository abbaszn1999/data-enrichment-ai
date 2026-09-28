"use client";

/**
 * Shared "Columns" panel: every column (source or AI/result) in one list,
 * each with a drag handle to reorder and a checkbox to show/hide. Used by
 * Catalog Intelligence, Product Gallery and the Visualizer so column layout
 * behaves the same everywhere.
 */
import { useRef, useState } from "react";
import { GripVertical, Sparkles } from "lucide-react";

export interface ColumnLayoutItem {
  key: string;
  label: string;
  /** Shows the Sparkles icon and a subtler style, matching AI/result column headers. */
  isAi?: boolean;
}

export function ColumnLayoutPanel({
  items,
  hidden,
  onToggleHidden,
  onMove,
}: {
  /** Every column, in full saved order (including hidden ones). */
  items: ColumnLayoutItem[];
  hidden: Set<string>;
  onToggleHidden: (key: string) => void;
  onMove: (fromKey: string, toKey: string) => void;
}) {
  const dragKeyRef = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  return (
    <div className="space-y-0.5 max-h-[320px] overflow-y-auto custom-scrollbar">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pb-1">
        Columns
      </div>
      {items.map((item) => {
        const visible = !hidden.has(item.key);
        const isDragOver = dragOverKey === item.key;
        return (
          <div
            key={item.key}
            draggable
            onDragStart={() => {
              dragKeyRef.current = item.key;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragKeyRef.current && dragKeyRef.current !== item.key) setDragOverKey(item.key);
            }}
            onDragLeave={() => setDragOverKey(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverKey(null);
              if (dragKeyRef.current && dragKeyRef.current !== item.key) onMove(dragKeyRef.current, item.key);
              dragKeyRef.current = null;
            }}
            onDragEnd={() => {
              dragKeyRef.current = null;
              setDragOverKey(null);
            }}
            className={`flex items-center gap-1.5 px-1 py-1 rounded cursor-default text-xs transition-colors group ${
              isDragOver ? "bg-primary/10 border border-dashed border-primary/40" : "hover:bg-muted/50"
            }`}
          >
            <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-muted-foreground/30 group-hover:text-muted-foreground/70" />
            <label className="flex flex-1 items-center gap-1.5 cursor-pointer overflow-hidden">
              <input
                type="checkbox"
                checked={visible}
                onChange={() => onToggleHidden(item.key)}
                className="h-3 w-3 shrink-0 rounded accent-primary"
              />
              {item.isAi && <Sparkles className="h-2.5 w-2.5 shrink-0 text-primary/70" />}
              <span className={`truncate ${visible ? "text-foreground" : "text-muted-foreground/50"}`}>
                {item.label}
              </span>
            </label>
          </div>
        );
      })}
    </div>
  );
}

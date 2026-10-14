"use client";

import { useEffect, useState } from "react";
import { subscribeCursor, type CursorState } from "@/lib/assistant/driver/cursor-controller";

/** The pointer that shows what the assistant is doing on the page. It never takes input. */
export function CursorOverlay() {
  const [cursor, setCursor] = useState<CursorState>({ visible: false, x: 0, y: 0, pressed: false, label: "" });
  useEffect(() => subscribeCursor(setCursor), []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[9999]"
      style={{
        transform: `translate(${cursor.x}px, ${cursor.y}px)`,
        opacity: cursor.visible ? 1 : 0,
        transition: "transform 550ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms",
      }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        style={{
          transform: cursor.pressed ? "scale(0.82)" : "scale(1)",
          transition: "transform 120ms",
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,.35))",
        }}
      >
        <path d="M4 2l16 9-7 2-3 7z" fill="#400095" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {cursor.label && (
        <span className="ml-5 -mt-1 inline-block whitespace-nowrap rounded-full bg-[#400095] px-2 py-0.5 text-[10px] font-semibold text-white shadow-md">
          {cursor.label}
        </span>
      )}
      {cursor.pressed && (
        <span className="absolute -left-2 -top-2 h-8 w-8 animate-ping rounded-full bg-[#F76D01]/40" />
      )}
    </div>
  );
}

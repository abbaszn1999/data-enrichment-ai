"use client";

import { useRef, useState } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import type { AttachedFile } from "@/lib/assistant/protocol";

const VISIBLE_CHIPS = 6;

export function Composer({
  running,
  attached,
  onSend,
  onStop,
  onAttach,
  onDetach,
}: {
  running: boolean;
  attached: AttachedFile[];
  onSend: (text: string) => void;
  onStop: () => void;
  onAttach: (files: FileList) => void;
  onDetach: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!text.trim() || running) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="border-t border-border/60 p-2">
      {attached.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {attached.slice(0, VISIBLE_CHIPS).map((file) => (
            <span key={file.id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]">
              <Paperclip className="h-3 w-3" /> {file.name}
              <button type="button" aria-label="Remove file" onClick={() => onDetach(file.id)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {attached.length > VISIBLE_CHIPS && (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]">
              +{attached.length - VISIBLE_CHIPS} more
              <button
                type="button"
                aria-label="Remove the other files"
                onClick={() => attached.slice(VISIBLE_CHIPS).forEach((file) => onDetach(file.id))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAttach(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          aria-label="Attach a spreadsheet or images"
          disabled={running}
          onClick={() => fileRef.current?.click()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          value={text}
          rows={1}
          maxLength={4000}
          disabled={running}
          placeholder={running ? "Working…" : "Ask the agent…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-28 min-h-9 flex-1 resize-none rounded-lg border border-border/60 bg-muted/35 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#6B358D]/25 disabled:opacity-60"
        />
        {running ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={onStop}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive text-white"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Send"
            disabled={!text.trim()}
            onClick={submit}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#400095] text-white disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

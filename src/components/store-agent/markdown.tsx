"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Agent text and reports: GitHub-flavoured Markdown, safe links, readable tables, RTL-aware. */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      dir="auto"
      className={cn(
        "prose prose-sm prose-neutral dark:prose-invert max-w-none break-words",
        "prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold",
        "prose-pre:my-2 prose-pre:rounded-lg prose-pre:bg-muted prose-pre:text-foreground",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
        "prose-table:my-3 prose-table:text-[13px] prose-th:bg-muted/60 prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-th:border prose-td:border prose-th:border-border prose-td:border-border",
        "prose-a:text-[#6B358D] dark:prose-a:text-[#F76D01] prose-a:no-underline hover:prose-a:underline",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="not-prose my-3 overflow-x-auto rounded-lg border">
              <table className="w-full border-collapse text-[13px] [&_td]:border-t [&_td]:px-3 [&_td]:py-1.5 [&_th]:bg-muted/60 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-start [&_th]:font-semibold">
                {children}
              </table>
            </div>
          ),
          img: () => null,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

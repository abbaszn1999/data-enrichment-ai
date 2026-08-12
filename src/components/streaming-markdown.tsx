"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

/**
 * Reveals text progressively so a reply that arrives in one network chunk still
 * reads as if it were being typed.
 *
 * Visual streaming is deliberately decoupled from network streaming: the agent
 * commits its answer through a tool call, so the whole string lands at once and
 * a naive render would flash the full block. Here the target text is stored in a
 * ref and a requestAnimationFrame loop walks a cursor towards it, which also
 * means text that arrives incrementally (thinking chunks) is absorbed without
 * restarting the animation.
 *
 * Whether a given block should animate at all is the CALLER's decision (see
 * `StreamingMarkdown`) — this hook only animates when told to. Reveal duration
 * is bounded, so a 4000-character answer is not slower to read than a
 * 200-character one.
 */
export function useRevealedText(
  text: string,
  options: { enabled?: boolean; targetDurationMs?: number } = {}
): { visible: string; isRevealing: boolean } {
  const { enabled = true, targetDurationMs = 1400 } = options;

  const [visibleLength, setVisibleLength] = useState(() => (enabled ? 0 : text.length));
  const frameRef = useRef<number | null>(null);
  const lengthRef = useRef(visibleLength);
  const targetRef = useRef(text);
  targetRef.current = text;

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const animate = enabled && !prefersReducedMotion;

  useEffect(() => {
    if (!animate) {
      lengthRef.current = text.length;
      setVisibleLength(text.length);
      return;
    }
    if (text.length === 0) {
      lengthRef.current = 0;
      setVisibleLength(0);
      return;
    }

    // The cursor lives in a ref, not in the state updater: scheduling the next
    // frame from inside an updater would double up whenever React re-invokes it.
    const step = () => {
      frameRef.current = null;
      const total = targetRef.current.length;
      if (lengthRef.current >= total) return;
      // ~60fps → bound the whole reveal to targetDurationMs regardless of
      // length, with a floor so short replies still animate visibly.
      const frames = Math.max(1, Math.round(targetDurationMs / 16));
      const perFrame = Math.max(2, Math.ceil(total / frames));
      lengthRef.current = Math.min(total, lengthRef.current + perFrame);
      setVisibleLength(lengthRef.current);
      if (lengthRef.current < total) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [text, animate, targetDurationMs]);

  const effectiveLength = animate ? Math.min(visibleLength, text.length) : text.length;
  return {
    visible: text.slice(0, effectiveLength),
    isRevealing: animate && effectiveLength < text.length,
  };
}

/**
 * Message ids whose reply has already been typed out. Keyed by id rather than
 * by "was there text on first render", because the caller only mounts this
 * block once the reply is complete — at which point every message looks like
 * history. The id is the only signal that survives re-renders and re-mounts,
 * so scrolling or a parent update can never replay an animation.
 */
const revealedMessages = new Set<string>();

/** Forget reveal history — call when the chat is cleared. */
export function resetRevealedMessages(): void {
  revealedMessages.clear();
}

/**
 * Markdown block that types itself in the first time a given message is shown.
 * `onReveal` fires once per animation frame so the caller can keep the scroll
 * pinned to the bottom while the text grows.
 */
export function StreamingMarkdown({
  text,
  messageId,
  animate = true,
  onReveal,
  className,
}: {
  text: string;
  messageId: string;
  /** Set false for messages that should appear instantly (e.g. history). */
  animate?: boolean;
  onReveal?: () => void;
  className?: string;
}) {
  const isFresh = useRef(animate && !revealedMessages.has(messageId));

  useEffect(() => {
    if (isFresh.current) revealedMessages.add(messageId);
  }, [messageId]);

  const { visible, isRevealing } = useRevealedText(text, {
    enabled: isFresh.current,
  });

  useEffect(() => {
    if (isRevealing) onReveal?.();
  }, [visible, isRevealing, onReveal]);

  return (
    <div className={className}>
      <ReactMarkdown>{visible}</ReactMarkdown>
      {isRevealing && (
        <span
          aria-hidden
          className="inline-block w-[2px] h-[0.9em] -mb-[0.1em] ml-0.5 bg-current animate-pulse"
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  isWelcomeGiftOpen,
  type WelcomeGiftState,
} from "@/lib/billing/welcome-gift";
import { formatCredits } from "@/lib/format-credits";
import { useWelcomeGiftRemaining } from "@/hooks/use-welcome-gift-remaining";

export function WelcomeGiftTicker({
  gift,
  href,
}: {
  gift: WelcomeGiftState;
  href: string;
}) {
  const remaining = useWelcomeGiftRemaining(gift.expiresAt);
  const open = isWelcomeGiftOpen(gift) && remaining !== null;
  if (!open || !remaining) return null;

  const credits = formatCredits(gift.credits);
  const headline = `${credits} free credits — claim in ${remaining}`;

  return (
    <Link
      href={href}
      title="Claim your welcome credits on Billing"
      className="welcome-gift-ticker group relative flex h-7 max-w-[min(28rem,100%)] min-w-0 items-center overflow-hidden rounded-full border border-[#C40000]/25 bg-[linear-gradient(90deg,rgba(196,0,0,0.08),rgba(64,0,149,0.08))] px-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition-colors hover:border-[#C40000]/45 hover:bg-[linear-gradient(90deg,rgba(196,0,0,0.14),rgba(64,0,149,0.12))]"
    >
      <span className="relative z-10 mr-2 inline-flex shrink-0 items-center gap-1 rounded-full bg-[#C40000] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.16em] text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        Live
      </span>
      <TickerCopy text={headline} />
    </Link>
  );
}

function TickerCopy({ text }: { text: string }) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const measure = measureRef.current;
    const wrap = wrapRef.current;
    if (!measure || !wrap) return;
    const update = () => setOverflow(measure.scrollWidth > wrap.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={wrapRef} className="relative min-w-0 flex-1 overflow-hidden">
      <span
        ref={measureRef}
        className="invisible absolute whitespace-nowrap text-[11px] font-semibold tracking-tight"
        aria-hidden
      >
        {text}
      </span>
      {overflow ? (
        <span className="welcome-ticker-track inline-flex whitespace-nowrap text-[11px] font-semibold tracking-tight text-foreground">
          <span className="pr-8">{text}</span>
          <span className="pr-8" aria-hidden>
            {text}
          </span>
        </span>
      ) : (
        <span className="block truncate text-[11px] font-semibold tracking-tight text-foreground">
          {text}
        </span>
      )}
    </span>
  );
}

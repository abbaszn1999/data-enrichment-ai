"use client";

import { useEffect, useState } from "react";
import { formatWelcomeGiftRemaining } from "@/lib/billing/welcome-gift";

export function useWelcomeGiftRemaining(expiresAt: string | null): string | null {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!expiresAt) return;
    const ms = new Date(expiresAt).getTime() - Date.now();
    const timeout = window.setTimeout(() => setNow(new Date()), Math.max(0, ms + 50));
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(id);
    };
  }, [expiresAt]);

  if (!expiresAt) return null;
  if (new Date(expiresAt).getTime() <= now.getTime()) return null;
  return formatWelcomeGiftRemaining(expiresAt, now);
}

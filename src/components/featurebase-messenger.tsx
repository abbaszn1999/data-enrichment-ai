"use client";

import { useEffect } from "react";

type FeaturebaseFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

declare global {
  interface Window {
    Featurebase?: FeaturebaseFn;
  }
}

const SDK_ID = "featurebase-sdk";
const SDK_SRC = "https://do.featurebase.app/js/sdk.js";

function loadSdk() {
  if (typeof window.Featurebase !== "function") {
    const queue: FeaturebaseFn = function (...args: unknown[]) {
      (queue.q = queue.q || []).push(args);
    };
    window.Featurebase = queue;
  }
  if (document.getElementById(SDK_ID)) return;
  const script = document.createElement("script");
  script.id = SDK_ID;
  script.src = SDK_SRC;
  script.async = true;
  document.head.appendChild(script);
}

async function fetchIdentityToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/featurebase/token", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string | null };
    return data.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Featurebase messenger (the Fibi AI agent + help center search).
 *
 * Renders nothing and loads no third-party script unless
 * NEXT_PUBLIC_FEATUREBASE_APP_ID (the Featurebase organization id) is set, so
 * it is safe to ship before the agent is switched on.
 *
 * Featurebase has identity verification enabled, so users are identified with
 * a server-signed token from /api/featurebase/token. If no token is available
 * (secret not configured yet) the messenger still opens, anonymously.
 */
export function FeaturebaseMessenger({ userId }: { userId?: string | null }) {
  const appId = process.env.NEXT_PUBLIC_FEATUREBASE_APP_ID;

  useEffect(() => {
    if (!appId || !userId) return;
    let cancelled = false;
    let booted = false;

    (async () => {
      const token = await fetchIdentityToken();
      if (cancelled) return;
      loadSdk();
      window.Featurebase?.("boot", {
        appId,
        language: "en",
        ...(token ? { featurebaseJwt: token } : {}),
      });
      booted = true;
    })();

    return () => {
      cancelled = true;
      if (booted) window.Featurebase?.("shutdown");
    };
  }, [appId, userId]);

  return null;
}

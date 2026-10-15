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

/**
 * Featurebase messenger (the Fibi AI agent + help center search).
 *
 * Renders nothing and loads no third-party script unless
 * NEXT_PUBLIC_FEATUREBASE_APP_ID (the Featurebase organization id) is set, so
 * it is safe to ship before the agent is switched on in the Featurebase
 * dashboard.
 */
export function FeaturebaseMessenger({
  email,
  name,
  userId,
}: {
  email?: string | null;
  name?: string | null;
  userId?: string | null;
}) {
  const appId = process.env.NEXT_PUBLIC_FEATUREBASE_APP_ID;

  useEffect(() => {
    if (!appId || !userId) return;
    loadSdk();
    window.Featurebase?.("boot", {
      appId,
      userId,
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      language: "en",
    });
    return () => {
      window.Featurebase?.("shutdown");
    };
  }, [appId, userId, email, name]);

  return null;
}

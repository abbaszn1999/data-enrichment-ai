import { CANONICAL_APP_ORIGIN } from "@/lib/app-origin";

/** Mirrors public/widget.js getApiBaseUrl — keep both in lockstep. */
export function resolveWidgetApiOrigin(params: {
  scriptSrc?: string | null;
  hostname?: string | null;
}): string {
  if (params.scriptSrc) {
    try {
      const origin = new URL(params.scriptSrc).origin;
      if (origin && origin !== "null") return origin;
    } catch {
      /* fall through */
    }
  }
  if (params.hostname === "localhost" || params.hostname === "127.0.0.1") {
    return `http://${params.hostname}`;
  }
  return CANONICAL_APP_ORIGIN;
}

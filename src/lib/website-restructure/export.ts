import { escapeHtml } from "@/lib/html-escape";
import type { WrBuildResult } from "./types";

/** Literal placeholder the agent is instructed to use for the store logo's
 *  `src`, so the real URL (preview: signed URL, download: base64) can be
 *  substituted after generation without re-running the model. */
export const WR_LOGO_PLACEHOLDER = "{{WR_LOGO_SRC}}";

export function injectLogoSrc(html: string, logoSrc: string | null): string {
  if (!logoSrc) return html.split(WR_LOGO_PLACEHOLDER).join("");
  return html.split(WR_LOGO_PLACEHOLDER).join(logoSrc);
}

/**
 * Assembles the three generated fragments into one standalone HTML document.
 * No external CDN, no build step required on the merchant's side — this is
 * the entire deliverable.
 */
export function buildStandaloneHtmlDocument(input: {
  result: WrBuildResult;
  logoSrc: string | null;
  title?: string;
  dir?: "ltr" | "rtl";
}): string {
  const html = injectLogoSrc(input.result.html, input.logoSrc);
  const title = escapeHtml(input.title?.trim() || "Store Header");
  const dir = input.dir === "rtl" ? "rtl" : "ltr";

  return [
    "<!DOCTYPE html>",
    `<html lang="${dir === "rtl" ? "ar" : "en"}" dir="${dir}">`,
    "<head>",
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <title>${title}</title>`,
    "  <style>",
    input.result.css,
    "  </style>",
    "</head>",
    "<body>",
    html,
    "  <script>",
    input.result.js,
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
}

/** Fetches the logo and returns it as a base64 data URI, for a download that
 *  stays self-contained after the signed preview URL expires. Never throws —
 *  a failed fetch just means the downloaded file ships without a logo. */
export async function logoUrlToDataUri(logoUrl: string): Promise<string | null> {
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

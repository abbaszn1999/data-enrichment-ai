export function gscPropertyOrigin(property: string | null | undefined): string | null {
  if (!property) return null;
  const trimmed = property.trim();
  if (/^sc-domain:/i.test(trimmed)) {
    const domain = trimmed.replace(/^sc-domain:/i, "").replace(/\/+$/, "");
    return domain ? `https://${domain}` : null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  } catch {
    // Ignore unparseable properties.
  }
  return null;
}

export function analyticsPageHref(page: string, siteProperty?: string | null): string | null {
  const trimmed = page.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const origin = gscPropertyOrigin(siteProperty);
  if (!origin) return null;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${origin}${path}`;
}

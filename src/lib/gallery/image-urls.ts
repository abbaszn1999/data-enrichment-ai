export function parseImageUrls(value: unknown): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of text.split(/[\s,|;]+/)) {
    const candidate = part.trim();
    if (!/^https?:\/\//i.test(candidate) || seen.has(candidate)) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      seen.add(candidate);
      urls.push(candidate);
    } catch {
      // Ignore malformed cells while preserving the rest of the row.
    }
  }
  return urls;
}

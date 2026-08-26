/**
 * Shared flatteners for enriched cell values across the XLSX / CSV / JSON exports.
 * Objects come in three shapes: images ({imageUrl}), sources ({uri}) and FAQ
 * ({question, answer}); everything else is a string or a list of strings.
 */

interface FaqEntry {
  question?: string;
  answer?: string;
}

function isFaqEntry(item: unknown): item is FaqEntry {
  return typeof item === "object" && item !== null && "question" in item;
}

function faqToText(items: unknown[]): string {
  return items
    .filter(isFaqEntry)
    .map((i) => `Q: ${i.question ?? ""}\nA: ${i.answer ?? ""}`)
    .join("\n\n");
}

function urlList(items: unknown[], key: "imageUrl" | "uri"): string[] {
  return items
    .map((i) => {
      if (typeof i === "object" && i !== null) {
        const rec = i as Record<string, unknown>;
        return String(rec[key] ?? rec.url ?? "");
      }
      return String(i ?? "");
    })
    .filter(Boolean);
}

/** Flattens any enriched value to a single spreadsheet cell string. */
export function enrichedValueToText(value: unknown, columnId: string): string {
  if (value === undefined || value === null) return "";

  if (Array.isArray(value)) {
    if (columnId === "imageUrls") return urlList(value, "imageUrl").join("\n");
    if (columnId === "sourceUrls") return urlList(value, "uri").join("\n");
    if (value.some(isFaqEntry)) return faqToText(value);
    return value
      .map((i) => {
        if (typeof i === "object" && i !== null) {
          const rec = i as Record<string, unknown>;
          return String(rec.imageUrl ?? rec.uri ?? rec.title ?? JSON.stringify(i));
        }
        return String(i);
      })
      .join("\n");
  }

  return String(value);
}

/** Keeps structure for JSON export: URL lists collapse to strings, FAQ stays as objects. */
export function enrichedValueToJson(value: unknown, columnId: string): unknown {
  if (value === undefined || value === null) return "";

  if (Array.isArray(value)) {
    if (columnId === "imageUrls") return urlList(value, "imageUrl");
    if (columnId === "sourceUrls") return urlList(value, "uri");
    if (value.some(isFaqEntry)) {
      return value.filter(isFaqEntry).map((i) => ({
        question: i.question ?? "",
        answer: i.answer ?? "",
      }));
    }
    return value;
  }

  return value;
}

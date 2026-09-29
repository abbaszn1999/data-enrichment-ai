/**
 * Extracts the first balanced `{...}` JSON object from free text. Google AI
 * Mode's answer is not guaranteed to be pure JSON even when explicitly asked
 * for it — testing found both leading commentary before the object and
 * trailing prose after it ("If you want to look for this item in a specific
 * size..."), so a plain `JSON.parse` on the whole string is not reliable.
 * Pure and dependency-free so it is cheap to unit test on real captured
 * outputs.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const stripped = text.replace(/```json/gi, "```").replace(/```/g, "");
  const start = stripped.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = stripped.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

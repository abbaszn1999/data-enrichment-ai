/** Why a product picture could not be downloaded, in terms a store owner can act on. */
export type ImageDownloadFailure =
  | "timeout"
  | "network"
  | "server"
  | "refused"
  | "missing"
  | "not_image"
  | "too_large"
  | "unsafe"
  | "other";

/** Failures where a lighter copy of the same picture may still arrive. */
export function isSlowOrigin(failure: ImageDownloadFailure | undefined): boolean {
  return failure === "timeout" || failure === "network" || failure === "server";
}

export function failureFromStatus(status: number | null | undefined): ImageDownloadFailure {
  if (status === 404 || status === 410) return "missing";
  if (status === 401 || status === 403 || status === 429 || status === 451) return "refused";
  if (typeof status === "number" && status >= 500) return "server";
  return "other";
}

/**
 * Shops that resize on demand (`?size=2000`, `?width=2400`) answer a huge first
 * request slowly, and a product reference never needs more than ~1200px. The
 * lighter link is only tried after the original one failed.
 */
const SIZE_PARAMS = ["size", "w", "width", "maxwidth", "max_width", "imwidth", "sw"];
const LIGHT_SIZE = 1200;

export function lighterImageUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    for (const name of SIZE_PARAMS) {
      const raw = parsed.searchParams.get(name);
      if (!raw || !/^\d{3,5}$/.test(raw)) continue;
      if (Number(raw) <= LIGHT_SIZE) continue;
      parsed.searchParams.set(name, String(LIGHT_SIZE));
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

const BASE_MESSAGE = "Could not download the image from the selected image column";

/** The row message: always the base text, plus the reason and what to do when it is known. */
export function imageDownloadFailureMessage(
  url: string | undefined,
  failure: ImageDownloadFailure | undefined
): string {
  let host = "";
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  const site = host || "The website";
  switch (failure) {
    case "timeout":
      return `${BASE_MESSAGE}: ${site} took too long to answer. Retry this product, or upload the picture into the sheet.`;
    case "network":
    case "server":
      return `${BASE_MESSAGE}: ${site} did not respond. Retry this product, or upload the picture into the sheet.`;
    case "refused":
      return `${BASE_MESSAGE}: ${site} does not allow downloads from our server. Upload the picture into the sheet instead.`;
    case "missing":
      return `${BASE_MESSAGE}: the link no longer exists on ${site}.`;
    case "not_image":
      return `${BASE_MESSAGE}: the link on ${site} is not a picture file we can read.`;
    case "too_large":
      return `${BASE_MESSAGE}: the picture on ${site} is too large.`;
    default:
      return BASE_MESSAGE;
  }
}

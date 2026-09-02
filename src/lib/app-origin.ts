export const CANONICAL_APP_ORIGIN = "https://platform.autommerce.com";

export function getAppOrigin(): string {
  const fromEnv = (
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/+$/, "");
  return fromEnv || CANONICAL_APP_ORIGIN;
}

export function snippetOrigin(currentOrigin?: string): string {
  const current = (currentOrigin || "").replace(/\/+$/, "");
  if (
    !current ||
    current.includes("localhost") ||
    current.includes("127.0.0.1")
  ) {
    return getAppOrigin();
  }
  return current;
}

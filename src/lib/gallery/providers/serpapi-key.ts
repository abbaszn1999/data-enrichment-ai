/**
 * Prefer SERP_API_KEY (project convention); accept SERPAPI_API_KEY as alias.
 */
export function requireSerpApiKey(): string {
  const apiKey =
    process.env.SERP_API_KEY?.trim() || process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "SERP_API_KEY is not configured (required for SerpApi Google Images + Lens)"
    );
  }
  return apiKey;
}

import { timingSafeEqual } from "crypto";

export function cronSecretFromEnv(): string | null {
  const secret =
    process.env.JOBS_CRON_SECRET?.trim() ||
    process.env.GROWTH_SYNC_CRON_SECRET?.trim();
  return secret || null;
}

export function cronSecretMatches(
  request: Request,
  secret: string
): boolean {
  const presented =
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ?? "";
  const left = Buffer.from(presented);
  const right = Buffer.from(secret);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

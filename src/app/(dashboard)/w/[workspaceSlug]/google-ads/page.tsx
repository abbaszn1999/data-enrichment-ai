import { cookies } from "next/headers";
import { GoogleAdsLock } from "@/components/google-ads/ga-lock";
import { GoogleAdsShell } from "@/components/google-ads/ga-shell";
import { PREVIEW_COOKIE, hasPreviewAccess } from "@/lib/google-ads/preview-access";

export const dynamic = "force-dynamic";

/**
 * Google Ads agent — chat with the agent on the left, the full account on the
 * right. Front-end prototype on demo data until the Google Ads API is wired,
 * open only to people given its password (checked on the server).
 */
export default async function GoogleAdsPage() {
  const unlocked = hasPreviewAccess((await cookies()).get(PREVIEW_COOKIE)?.value);
  return unlocked ? <GoogleAdsShell /> : <GoogleAdsLock />;
}

"use client";

import { useAccountState, useGoogleAds } from "@/lib/google-ads/store";
import type { AccountData, Campaign } from "@/lib/google-ads/types";

/** Everything a view needs; views only render once an account is selected. */
export function useGa() {
  const acc = useAccountState()!;
  const range = useGoogleAds((s) => s.range);
  const scope = useGoogleAds((s) => s.scope);
  const data = acc.data;
  return {
    acc,
    data,
    range,
    scope,
    currency: data.account.currency,
    campaign: data.campaigns.find((c) => c.id === scope.campaignId),
    adGroup: data.adGroups.find((g) => g.id === scope.adGroupId),
  };
}

/** Campaign ids visible at the current scope. */
export function scopedCampaignIds(data: AccountData, campaign?: Campaign): string[] {
  return campaign ? [campaign.id] : data.campaigns.filter((c) => c.status !== "REMOVED").map((c) => c.id);
}

/** Ad group ids visible at the current scope. */
export function scopedAdGroupIds(data: AccountData, scope: { campaignId?: string; adGroupId?: string }): string[] {
  if (scope.adGroupId) return [scope.adGroupId];
  return data.adGroups
    .filter((g) => g.status !== "REMOVED" && (!scope.campaignId || g.campaignId === scope.campaignId))
    .filter((g) => data.campaigns.find((c) => c.id === g.campaignId)?.status !== "REMOVED")
    .map((g) => g.id);
}

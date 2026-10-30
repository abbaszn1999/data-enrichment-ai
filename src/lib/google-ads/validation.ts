// Client-side stand-in for a validateOnly mutate: catches what Google would
// reject before the change is sent. The server repeats it with the real API.

import { LIMITS } from "./constants";
import type { AccountData, Ad, AdText, MutateOp } from "./types";

function textErrors(ad: Pick<Ad, "headlines" | "descriptions" | "type" | "path1" | "path2" | "finalUrl">): string[] {
  const errors: string[] = [];
  const tooLong = (items: AdText[], max: number) => items.filter((h) => h.text.length > max).length;
  if (ad.type === "RESPONSIVE_SEARCH_AD") {
    if (ad.headlines.length < LIMITS.rsaHeadlinesMin) errors.push(`An ad needs at least ${LIMITS.rsaHeadlinesMin} headlines.`);
    if (ad.headlines.length > LIMITS.rsaHeadlinesMax) errors.push(`An ad can have at most ${LIMITS.rsaHeadlinesMax} headlines.`);
    if (ad.descriptions.length < LIMITS.rsaDescriptionsMin) errors.push(`An ad needs at least ${LIMITS.rsaDescriptionsMin} descriptions.`);
    if (ad.descriptions.length > LIMITS.rsaDescriptionsMax) errors.push(`An ad can have at most ${LIMITS.rsaDescriptionsMax} descriptions.`);
  }
  if (tooLong(ad.headlines, LIMITS.headline)) errors.push(`Headlines must be ${LIMITS.headline} characters or fewer.`);
  if (tooLong(ad.descriptions, LIMITS.description)) errors.push(`Descriptions must be ${LIMITS.description} characters or fewer.`);
  if ((ad.path1?.length ?? 0) > LIMITS.path || (ad.path2?.length ?? 0) > LIMITS.path) errors.push(`Display paths must be ${LIMITS.path} characters or fewer.`);
  if (!/^https?:\/\/.+\..+/.test(ad.finalUrl)) errors.push("Final URL must be a full web address.");
  if (/!{2,}/.test([...ad.headlines, ...ad.descriptions].map((x) => x.text).join(" "))) errors.push("Repeated exclamation marks are not allowed.");
  return errors;
}

export function validateOps(data: AccountData, ops: MutateOp[]): string[] {
  const errors: string[] = [];
  for (const op of ops) {
    switch (op.kind) {
      case "budget.update":
        if (!(op.amount >= 1)) errors.push("Daily budget must be at least 1.");
        break;
      case "campaign.create": {
        const { campaign, budget, adGroups, assetGroups } = op.bundle;
        if (!campaign.name.trim()) errors.push("Campaign name is required.");
        if (data.campaigns.some((c) => c.status !== "REMOVED" && c.name.trim().toLowerCase() === campaign.name.trim().toLowerCase()))
          errors.push(`A campaign named "${campaign.name}" already exists.`);
        if (!(budget.amount >= 1)) errors.push("Daily budget must be at least 1.");
        if (!campaign.locations.some((l) => !l.excluded)) errors.push("Pick at least one location to target.");
        if (campaign.bidding.type === "TARGET_CPA" && !(campaign.bidding.targetCpa! > 0)) errors.push("Target CPA must be above 0.");
        if (campaign.bidding.type === "TARGET_ROAS" && !(campaign.bidding.targetRoas! > 0)) errors.push("Target ROAS must be above 0.");
        if (campaign.type === "SEARCH") {
          if (!adGroups.length) errors.push("A Search campaign needs at least one ad group.");
          for (const g of adGroups) {
            if (!g.keywords.length) errors.push(`Ad group "${g.adGroup.name}" has no keywords.`);
            if (!g.ads.length) errors.push(`Ad group "${g.adGroup.name}" has no ad.`);
            for (const ad of g.ads) errors.push(...textErrors(ad));
          }
        }
        if (campaign.type === "PERFORMANCE_MAX") {
          if (!assetGroups.length) errors.push("Performance Max needs at least one asset group.");
          for (const g of assetGroups) {
            if (g.headlines.filter(Boolean).length < 3) errors.push(`Asset group "${g.name}" needs at least 3 headlines.`);
            if (!g.longHeadlines.filter(Boolean).length) errors.push(`Asset group "${g.name}" needs a long headline.`);
            if (g.descriptions.filter(Boolean).length < 2) errors.push(`Asset group "${g.name}" needs at least 2 descriptions.`);
          }
        }
        if (campaign.type === "SHOPPING" && !data.account.merchantCenterId) errors.push("Shopping needs a linked Merchant Center account.");
        break;
      }
      case "ad.create":
        for (const ad of op.ads) errors.push(...textErrors(ad));
        break;
      case "ad.update": {
        const ad = data.ads.find((a) => a.id === op.adId);
        if (ad) errors.push(...textErrors({ ...ad, ...op.patch }));
        break;
      }
      case "keyword.create":
        for (const k of op.keywords) {
          if (!k.text.trim()) errors.push("Keyword text is empty.");
          if (data.keywords.some((x) => x.adGroupId === k.adGroupId && x.status !== "REMOVED" && x.text === k.text && x.matchType === k.matchType))
            errors.push(`Keyword "${k.text}" already exists in this ad group.`);
        }
        break;
      case "adGroup.create":
        if (!op.adGroup.name.trim()) errors.push("Ad group name is required.");
        for (const ad of op.ads) errors.push(...textErrors(ad));
        break;
      default:
        break;
    }
  }
  return [...new Set(errors)];
}

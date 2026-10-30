"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CircleDot, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { BIDDING, BIDDING_BY_TYPE, CAMPAIGN_TYPES, GEO_TARGETS, LANGUAGES, LIMITS, OBJECTIVES, WEEKDAYS } from "@/lib/google-ads/constants";
import { money } from "@/lib/google-ads/metrics";
import { emptyBundle, gid, keywordLabel, parseKeywordLines, rateAdStrength } from "@/lib/google-ads/mutations";
import { useAccountState, useGoogleAds } from "@/lib/google-ads/store";
import { validateOps } from "@/lib/google-ads/validation";
import type { Ad, AdGroupType, AssetGroup, BiddingStrategyType, CampaignBundle, CampaignObjective, CampaignType, MatchType, MutateOp } from "@/lib/google-ads/types";
import { RsaEditor, emptyRsa, type RsaDraft } from "./ga-rsa-editor";
import { ACCENT_BTN, Field, ImageTile, LimitedInput, Pill, SelectBox, Toggle } from "./ga-ui";

type AgDraft = { key: string; name: string; keywords: string; ad: RsaDraft; extra: { longHeadline: string; businessName: string; videoUrl: string } };
type AssetGroupDraft = Omit<AssetGroup, "id" | "campaignId">;

type StepId = "objective" | "type" | "goals" | "bidding" | "settings" | "content" | "budget" | "review";

const STEP_LABEL: Record<StepId, string> = {
  objective: "Objective",
  type: "Campaign type",
  goals: "Name & goals",
  bidding: "Bidding",
  settings: "Campaign settings",
  content: "Ads & targeting",
  budget: "Budget",
  review: "Review",
};

const DOMAIN = "https://stride-demo.com";

function draftsFromBundle(bundle: CampaignBundle): AgDraft[] {
  return bundle.adGroups.map((g) => {
    const ad = g.ads[0];
    return {
      key: gid("agd"),
      name: g.adGroup.name,
      keywords: g.keywords.map((k) => keywordLabel(k.text, k.matchType)).join("\n"),
      ad: ad ? { headlines: ad.headlines, descriptions: ad.descriptions, finalUrl: ad.finalUrl, path1: ad.path1 ?? "", path2: ad.path2 ?? "" } : emptyRsa(`${DOMAIN}/`),
      extra: { longHeadline: ad?.longHeadline ?? "", businessName: ad?.businessName ?? "Stride", videoUrl: "" },
    };
  });
}

function emptyAssetGroup(): AssetGroupDraft {
  return {
    name: "Asset group 1",
    status: "ENABLED",
    finalUrl: `${DOMAIN}/`,
    headlines: ["", "", ""],
    longHeadlines: [""],
    descriptions: ["", ""],
    businessName: "Stride",
    imageUrls: [],
    logoUrls: ["logo-square"],
    videoUrls: [],
    audienceSignal: "",
    searchThemes: [],
    listingGroups: ["All products"],
    adStrength: "PENDING",
  };
}

export function GaCampaignEditor() {
  const editor = useGoogleAds((s) => s.editor);
  if (!editor.open) return null;
  return <Editor initial={editor.draft} changeId={editor.changeId} />;
}

function Editor({ initial, changeId }: { initial?: CampaignBundle; changeId?: string }) {
  const acc = useAccountState()!;
  const { data } = acc;
  const closeEditor = useGoogleAds((s) => s.closeEditor);
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const reviseChange = useGoogleAds((s) => s.reviseChange);
  const applyChange = useGoogleAds((s) => s.applyChange);
  const cur = data.account.currency;

  const [bundle, setBundle] = useState<CampaignBundle>(() => {
    if (initial) return initial;
    const b = emptyBundle();
    return { ...b, campaign: { ...b.campaign, conversionActionIds: data.conversions.filter((c) => c.primary).map((c) => c.id) } };
  });
  const [groups, setGroups] = useState<AgDraft[]>(() => (initial?.adGroups.length ? draftsFromBundle(initial) : []));
  const [assetGroup, setAssetGroup] = useState<AssetGroupDraft>(() => initial?.assetGroups[0] ?? emptyAssetGroup());
  const [step, setStep] = useState<StepId>(initial ? "review" : "objective");

  const c = bundle.campaign;
  const setCampaign = (patch: Partial<CampaignBundle["campaign"]>) => setBundle((b) => ({ ...b, campaign: { ...b.campaign, ...patch } }));
  const steps: StepId[] = ["objective", "type", "goals", "bidding", "settings", "content", "budget", "review"];
  const idx = steps.indexOf(step);

  const finalBundle = useMemo<CampaignBundle>(() => {
    const isSearch = c.type === "SEARCH";
    const agType: AdGroupType = isSearch ? "SEARCH_STANDARD" : c.type === "SHOPPING" ? "SHOPPING_PRODUCT_ADS" : c.type === "DEMAND_GEN" ? "DEMAND_GEN" : c.type === "VIDEO" ? "VIDEO" : "DISPLAY_STANDARD";
    const adGroups =
      c.type === "PERFORMANCE_MAX"
        ? []
        : c.type === "SHOPPING"
          ? [{ adGroup: { name: "All products", status: "ENABLED" as const, type: agType }, keywords: [], ads: [] }]
          : groups.map((g) => {
              const keywords = isSearch ? parseKeywordLines(g.keywords, "PHRASE").map((k) => ({ ...k, status: "ENABLED" as const })) : [];
              const hs = g.ad.headlines.filter((h) => h.text.trim());
              const ds = g.ad.descriptions.filter((d) => d.text.trim());
              const adType: Ad["type"] = isSearch ? "RESPONSIVE_SEARCH_AD" : c.type === "DEMAND_GEN" ? "DEMAND_GEN_AD" : c.type === "VIDEO" ? "VIDEO_AD" : "RESPONSIVE_DISPLAY_AD";
              const ads: Omit<Ad, "id" | "adGroupId" | "policy">[] = hs.length
                ? [
                    {
                      type: adType,
                      status: "ENABLED",
                      headlines: hs,
                      descriptions: ds,
                      finalUrl: g.ad.finalUrl,
                      path1: g.ad.path1 || undefined,
                      path2: g.ad.path2 || undefined,
                      longHeadline: isSearch ? undefined : g.extra.longHeadline || undefined,
                      businessName: isSearch ? undefined : g.extra.businessName || undefined,
                      adStrength: rateAdStrength(hs.map((h) => h.text), ds.map((d) => d.text), keywords.map((k) => k.text)),
                    },
                  ]
                : [];
              return { adGroup: { name: g.name.trim() || "Ad group", status: "ENABLED" as const, type: agType }, keywords, ads };
            });
    const ag = c.type === "PERFORMANCE_MAX"
      ? [{
          ...assetGroup,
          headlines: assetGroup.headlines.filter(Boolean),
          longHeadlines: assetGroup.longHeadlines.filter(Boolean),
          descriptions: assetGroup.descriptions.filter(Boolean),
          adStrength: rateAdStrength(assetGroup.headlines, assetGroup.descriptions),
        }]
      : [];
    return { ...bundle, budget: { ...bundle.budget, name: c.name }, adGroups, assetGroups: ag, campaign: { ...c, merchantFeed: c.type === "SHOPPING" || (c.type === "PERFORMANCE_MAX" && !!c.merchantFeed) } };
  }, [bundle, groups, assetGroup, c]);

  const op: MutateOp = useMemo(() => ({ kind: "campaign.create", bundle: finalBundle, tempId: gid("c") }), [finalBundle]);
  const errors = validateOps(data, [op]);

  const publish = () => {
    if (errors.length) {
      toast.error(errors[0]);
      return;
    }
    if (changeId) {
      reviseChange(changeId, [op], `Create campaign: ${c.name}`);
      applyChange(changeId);
      toast.success(`Published ${c.name}`);
      closeEditor();
      return;
    }
    const res = applyDirect(`Create campaign: ${c.name}`, [op]);
    if (res.ok) {
      toast.success(`Published ${c.name}`);
      closeEditor();
    } else toast.error(res.error);
  };

  const allowedTypes = OBJECTIVES[c.objective].types;
  const canNext = (() => {
    switch (step) {
      case "type":
        return allowedTypes.includes(c.type) && (!CAMPAIGN_TYPES[c.type].requiresMerchant || !!data.account.merchantCenterId);
      case "goals":
        return c.name.trim().length > 0;
      case "settings":
        return c.locations.some((l) => !l.excluded);
      case "budget":
        return bundle.budget.amount >= 1;
      default:
        return true;
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background [font-family:var(--brand-font)]">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
        <button type="button" onClick={closeEditor} className="rounded-lg p-1.5 hover:bg-muted" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-bold">{changeId ? "Review agent draft" : "New campaign"}</p>
          <p className="truncate text-[11px] text-muted-foreground">{c.name || "Untitled"} · {CAMPAIGN_TYPES[c.type].label}</p>
        </div>
        {changeId && <Pill tone="brand" className="ml-2">Drafted by agent</Pill>}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">{money(bundle.budget.amount, cur)}/day</span>
          <button type="button" onClick={publish} disabled={errors.length > 0} className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-semibold", ACCENT_BTN)}>
            <Check className="h-3.5 w-3.5" /> Publish campaign
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border/60 bg-muted/20 p-3 md:block">
          {steps.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs", s === step ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:bg-muted")}
            >
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", i < idx ? "bg-emerald-500 text-white" : s === step ? "bg-[#400095] text-white dark:bg-violet-600" : "bg-muted")}>
                {i < idx ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {s === "content" ? contentLabel(c.type) : STEP_LABEL[s]}
            </button>
          ))}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mx-auto max-w-4xl px-6 py-8">
            {step === "objective" && (
              <Section title="What's the goal of this campaign?" body="The goal shapes the recommended campaign types and settings.">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(Object.keys(OBJECTIVES) as CampaignObjective[]).map((o) => (
                    <Choice key={o} active={c.objective === o} onClick={() => setCampaign({ objective: o, type: OBJECTIVES[o].types.includes(c.type) ? c.type : OBJECTIVES[o].types[0] })} title={OBJECTIVES[o].label} body={OBJECTIVES[o].blurb} />
                  ))}
                </div>
              </Section>
            )}

            {step === "type" && (
              <Section title="Campaign type" body="Where your ads show and what they're built from.">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(Object.keys(CAMPAIGN_TYPES) as CampaignType[]).map((t) => {
                    const meta = CAMPAIGN_TYPES[t];
                    const blocked = !allowedTypes.includes(t) || (meta.requiresMerchant && !data.account.merchantCenterId);
                    return (
                      <Choice
                        key={t}
                        active={c.type === t}
                        disabled={blocked}
                        onClick={() => {
                          setCampaign({
                            type: t,
                            bidding: { type: BIDDING_BY_TYPE[t][0] },
                            networks: t === "SEARCH" ? { googleSearch: true, searchPartners: false, displayNetwork: false } : t === "DISPLAY" ? { googleSearch: false, searchPartners: false, displayNetwork: true } : { googleSearch: true, searchPartners: true, displayNetwork: true },
                          });
                          if (t !== "SHOPPING" && t !== "PERFORMANCE_MAX" && !groups.length) setGroups([{ key: gid("agd"), name: "Ad group 1", keywords: "", ad: emptyRsa(`${DOMAIN}/`), extra: { longHeadline: "", businessName: "Stride", videoUrl: "" } }]);
                        }}
                        title={meta.label}
                        body={meta.blurb}
                        footer={
                          <span className="text-[10px] text-muted-foreground">
                            {meta.where}
                            {blocked && meta.requiresMerchant && !data.account.merchantCenterId ? " · needs Merchant Center" : !allowedTypes.includes(t) ? " · not for this goal" : ""}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
                {c.type === "PERFORMANCE_MAX" && data.account.merchantCenterId && (
                  <label className="mt-4 flex items-center gap-3 rounded-xl border border-border/60 p-3">
                    <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 text-xs">
                      <span className="font-semibold">Use your product feed</span> from Merchant Center {data.account.merchantCenterId}
                    </span>
                    <Toggle checked={!!c.merchantFeed} onChange={(v) => setCampaign({ merchantFeed: v })} label="Use product feed" />
                  </label>
                )}
              </Section>
            )}

            {step === "goals" && (
              <Section title="Name and conversion goals" body="Bidding optimises for the conversion goals you pick here.">
                <Field label="Campaign name" counter={{ used: c.name.length, max: LIMITS.campaignName }}>
                  <Input value={c.name} onChange={(e) => setCampaign({ name: e.target.value })} placeholder={`e.g. Running Shoes – ${CAMPAIGN_TYPES[c.type].short} – KSA`} />
                </Field>
                <div className="mt-5 space-y-2">
                  <p className="text-xs font-semibold">Conversion goals</p>
                  {data.conversions.filter((x) => x.status !== "REMOVED").map((conv) => {
                    const on = c.conversionActionIds.includes(conv.id);
                    return (
                      <label key={conv.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3", on ? "border-[#400095]/50 bg-[#400095]/[0.04]" : "border-border/60")}>
                        <input type="checkbox" checked={on} onChange={() => setCampaign({ conversionActionIds: on ? c.conversionActionIds.filter((x) => x !== conv.id) : [...c.conversionActionIds, conv.id] })} className="accent-[#400095]" />
                        <span className="flex-1 text-xs font-semibold">{conv.name}</span>
                        <Pill tone={conv.primary ? "brand" : "neutral"}>{conv.primary ? "Account default" : "Secondary"}</Pill>
                        {conv.status === "UNVERIFIED" && <Pill tone="bad">Unverified</Pill>}
                      </label>
                    );
                  })}
                </div>
              </Section>
            )}

            {step === "bidding" && (
              <Section title="Bidding" body="How Google sets your bid in each auction.">
                <div className="grid gap-3 sm:grid-cols-2">
                  {BIDDING_BY_TYPE[c.type].map((b) => (
                    <Choice key={b} active={c.bidding.type === b} onClick={() => setCampaign({ bidding: { type: b } })} title={BIDDING[b].label} body={`Focus: ${BIDDING[b].focus}${BIDDING[b].target ? ` · with a target ${BIDDING[b].target}` : ""}`} />
                  ))}
                </div>
                <BiddingTarget type={c.bidding.type} value={c.bidding} onChange={(bidding) => setCampaign({ bidding })} currency={cur} />
              </Section>
            )}

            {step === "settings" && (
              <Section title="Campaign settings" body="Networks, locations, languages and timing.">
                <div className="space-y-6">
                  {c.type === "SEARCH" && (
                    <div className="space-y-3 rounded-xl border border-border/60 p-4">
                      <p className="text-xs font-bold">Networks</p>
                      <Row label="Search partners" hint="Show on sites that partner with Google Search">
                        <Toggle checked={c.networks.searchPartners} onChange={(v) => setCampaign({ networks: { ...c.networks, searchPartners: v } })} label="Search partners" />
                      </Row>
                      <Row label="Display Network" hint="Usually off for Search campaigns">
                        <Toggle checked={c.networks.displayNetwork} onChange={(v) => setCampaign({ networks: { ...c.networks, displayNetwork: v } })} label="Display Network" />
                      </Row>
                    </div>
                  )}
                  <div className="space-y-3 rounded-xl border border-border/60 p-4">
                    <p className="text-xs font-bold">Locations</p>
                    <div className="flex flex-wrap gap-1.5">
                      {GEO_TARGETS.map((g) => {
                        const sel = c.locations.find((l) => l.id === g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => setCampaign({ locations: sel ? (sel.excluded ? c.locations.filter((l) => l.id !== g.id) : c.locations.map((l) => (l.id === g.id ? { ...l, excluded: true } : l))) : [...c.locations, { ...g }] })}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px]",
                              !sel ? "border-border/70 text-muted-foreground" : sel.excluded ? "border-red-500/50 bg-red-500/10 text-red-700 line-through dark:text-red-400" : "border-[#400095] bg-[#400095]/10 font-semibold text-[#400095] dark:border-violet-400 dark:text-violet-300"
                            )}
                          >
                            {g.name}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Click once to target, twice to exclude, three times to clear.</p>
                  </div>
                  <div className="space-y-3 rounded-xl border border-border/60 p-4">
                    <p className="text-xs font-bold">Languages</p>
                    <div className="flex flex-wrap gap-1.5">
                      {LANGUAGES.map((l) => {
                        const on = c.languages.includes(l);
                        return (
                          <button key={l} type="button" onClick={() => setCampaign({ languages: on ? c.languages.filter((x) => x !== l) : [...c.languages, l] })} className={cn("rounded-full border px-2.5 py-1 text-[11px]", on ? "border-[#400095] bg-[#400095]/10 font-semibold text-[#400095] dark:border-violet-400 dark:text-violet-300" : "border-border/70 text-muted-foreground")}>
                            {l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-3 rounded-xl border border-border/60 p-4 sm:grid-cols-3">
                    <Field label="Start date">
                      <Input type="date" value={c.startDate} onChange={(e) => setCampaign({ startDate: e.target.value })} />
                    </Field>
                    <Field label="End date" hint="Optional">
                      <Input type="date" value={c.endDate ?? ""} onChange={(e) => setCampaign({ endDate: e.target.value || undefined })} />
                    </Field>
                    <Field label="Ad schedule">
                      <SelectBox
                        value={c.schedule.length ? "BUSINESS" : "ALL"}
                        onChange={(v) => setCampaign({ schedule: v === "ALL" ? [] : WEEKDAYS.map((day) => ({ day, startHour: 8, endHour: 24 })) })}
                        options={[{ value: "ALL", label: "All day" }, { value: "BUSINESS", label: "8:00 – 24:00 daily" }]}
                      />
                    </Field>
                  </div>
                  <div className="space-y-3 rounded-xl border border-border/60 p-4">
                    {c.type === "SEARCH" && (
                      <Row label="AI Max for Search" hint="Broader matching and final URL expansion using your site and assets">
                        <Toggle checked={!!c.aiMax} onChange={(v) => setCampaign({ aiMax: v })} label="AI Max" />
                      </Row>
                    )}
                    <Row label="Contains EU political ads" hint="Required declaration for every campaign">
                      <Toggle checked={c.euPoliticalAds} onChange={(v) => setCampaign({ euPoliticalAds: v })} label="EU political ads" />
                    </Row>
                  </div>
                </div>
              </Section>
            )}

            {step === "content" && (
              <Section title={contentLabel(c.type)} body={contentBlurb(c.type)}>
                {c.type === "PERFORMANCE_MAX" ? (
                  <AssetGroupEditor value={assetGroup} onChange={setAssetGroup} />
                ) : c.type === "SHOPPING" ? (
                  <div className="rounded-xl border border-border/60 p-4 text-xs">
                    <p className="font-semibold">Products from Merchant Center {data.account.merchantCenterId}</p>
                    <p className="mt-1 text-muted-foreground">Shopping ads are built from your product feed: title, image and price. There are no keywords or text ads. Better product data from Catalog Intelligence means better Shopping ads.</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Pill tone="good">1,284 products approved</Pill>
                      <Pill tone="warn">37 limited</Pill>
                      <Pill tone="bad">12 disapproved</Pill>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {groups.map((g, gi) => (
                      <div key={g.key} className="rounded-2xl border border-border/60 p-4">
                        <div className="mb-4 flex items-center gap-2">
                          <CircleDot className="h-4 w-4 text-[#400095] dark:text-violet-400" />
                          <Input value={g.name} onChange={(e) => setGroups((all) => all.map((x) => (x.key === g.key ? { ...x, name: e.target.value } : x)))} className="h-8 max-w-xs font-semibold" />
                          {groups.length > 1 && (
                            <button type="button" onClick={() => setGroups((all) => all.filter((x) => x.key !== g.key))} className="ml-auto rounded p-1 text-muted-foreground hover:text-red-600" aria-label="Remove ad group">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        {c.type === "SEARCH" ? (
                          <>
                            <Field label="Keywords" hint={'One per line. "phrase", [exact], or plain for phrase match.'}>
                              <textarea
                                value={g.keywords}
                                onChange={(e) => setGroups((all) => all.map((x) => (x.key === g.key ? { ...x, keywords: e.target.value } : x)))}
                                rows={4}
                                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none dark:bg-input/30"
                              />
                            </Field>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {parseKeywordLines(g.keywords, "PHRASE").map((k) => (
                                <span key={k.matchType + k.text} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{keywordLabel(k.text, k.matchType as MatchType)}</span>
                              ))}
                            </div>
                            <div className="mt-4 border-t border-border/60 pt-4">
                              <RsaEditor value={g.ad} onChange={(ad) => setGroups((all) => all.map((x) => (x.key === g.key ? { ...x, ad } : x)))} keywords={parseKeywordLines(g.keywords).map((k) => k.text)} />
                            </div>
                          </>
                        ) : (
                          <VisualAdEditor
                            type={c.type}
                            draft={g}
                            onChange={(next) => setGroups((all) => all.map((x, i) => (i === gi ? next : x)))}
                          />
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setGroups((all) => [...all, { key: gid("agd"), name: `Ad group ${all.length + 1}`, keywords: "", ad: emptyRsa(`${DOMAIN}/`), extra: { longHeadline: "", businessName: "Stride", videoUrl: "" } }])}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add ad group
                    </button>
                  </div>
                )}
              </Section>
            )}

            {step === "budget" && (
              <Section title="Budget" body="Your average daily spend. You're charged at most 30.4× this per month.">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[30, 60, 120].map((v) => (
                    <Choice key={v} active={bundle.budget.amount === v} onClick={() => setBundle((b) => ({ ...b, budget: { ...b.budget, amount: v } }))} title={`${money(v, cur)}/day`} body={`≈ ${money(v * 30.4, cur)}/month · est. ${Math.round(v / 0.8 * 30)} clicks`} />
                  ))}
                </div>
                <Field label={`Custom amount (${cur}/day)`}>
                  <Input type="number" min={1} value={bundle.budget.amount} onChange={(e) => setBundle((b) => ({ ...b, budget: { ...b.budget, amount: Number(e.target.value) } }))} className="mt-4 max-w-48" />
                </Field>
              </Section>
            )}

            {step === "review" && (
              <Section title="Review your campaign" body="Check everything before it goes live. You can edit any step.">
                {errors.length > 0 && (
                  <div className="mb-4 space-y-1 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                    {errors.map((e) => (
                      <p key={e} className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400"><AlertTriangle className="h-3.5 w-3.5" /> {e}</p>
                    ))}
                  </div>
                )}
                <div className="divide-y divide-border/60 rounded-2xl border border-border/60">
                  <ReviewRow label="Campaign" onEdit={() => setStep("goals")}>{c.name || "—"} · {OBJECTIVES[c.objective].label} · {CAMPAIGN_TYPES[c.type].label}</ReviewRow>
                  <ReviewRow label="Conversion goals" onEdit={() => setStep("goals")}>{data.conversions.filter((x) => c.conversionActionIds.includes(x.id)).map((x) => x.name).join(", ") || "Account default"}</ReviewRow>
                  <ReviewRow label="Bidding" onEdit={() => setStep("bidding")}>
                    {BIDDING[c.bidding.type].label}
                    {c.bidding.targetCpa ? ` · ${money(c.bidding.targetCpa, cur)}` : ""}
                    {c.bidding.targetRoas ? ` · ${Math.round(c.bidding.targetRoas * 100)}%` : ""}
                  </ReviewRow>
                  <ReviewRow label="Locations" onEdit={() => setStep("settings")}>{c.locations.map((l) => `${l.excluded ? "Exclude " : ""}${l.name}`).join(", ") || "—"}</ReviewRow>
                  <ReviewRow label="Languages" onEdit={() => setStep("settings")}>{c.languages.join(", ")}</ReviewRow>
                  <ReviewRow label="Networks" onEdit={() => setStep("settings")}>{[c.networks.googleSearch && "Google Search", c.networks.searchPartners && "Search partners", c.networks.displayNetwork && "Display Network"].filter(Boolean).join(", ")}</ReviewRow>
                  <ReviewRow label={contentLabel(c.type)} onEdit={() => setStep("content")}>
                    {c.type === "PERFORMANCE_MAX"
                      ? `${finalBundle.assetGroups[0]?.name}: ${finalBundle.assetGroups[0]?.headlines.length} headlines, ${finalBundle.assetGroups[0]?.descriptions.length} descriptions, ${finalBundle.assetGroups[0]?.imageUrls.length} images`
                      : c.type === "SHOPPING"
                        ? "All products from Merchant Center"
                        : finalBundle.adGroups.map((g) => `${g.adGroup.name} (${g.keywords.length} kw, ${g.ads.length} ad)`).join(" · ")}
                  </ReviewRow>
                  <ReviewRow label="Budget" onEdit={() => setStep("budget")}>{money(bundle.budget.amount, cur)}/day · ≈ {money(bundle.budget.amount * 30.4, cur)}/month</ReviewRow>
                  {finalBundle.negativeKeywords.length > 0 && <ReviewRow label="Negative keywords">{finalBundle.negativeKeywords.map((n) => keywordLabel(n.text, n.matchType)).join(", ")}</ReviewRow>}
                  {finalBundle.assets.length > 0 && <ReviewRow label="Assets">{finalBundle.assets.map((a) => a.title).join(", ")}</ReviewRow>}
                </div>
              </Section>
            )}
          </motion.div>
        </main>
      </div>

      <div className="flex h-14 shrink-0 items-center justify-between border-t border-border/60 px-4">
        <button type="button" onClick={() => setStep(steps[Math.max(0, idx - 1)])} disabled={idx === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-40">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        {step !== "review" ? (
          <button type="button" onClick={() => setStep(steps[idx + 1])} disabled={!canNext} className={cn("inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold", ACCENT_BTN)}>
            Next <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button type="button" onClick={publish} disabled={errors.length > 0} className={cn("inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold", ACCENT_BTN)}>
            <Check className="h-3.5 w-3.5" /> Publish campaign
          </button>
        )}
      </div>
    </div>
  );
}

function contentLabel(type: CampaignType) {
  return type === "SEARCH" ? "Keywords & ads" : type === "PERFORMANCE_MAX" ? "Asset group" : type === "SHOPPING" ? "Products" : "Ad groups & ads";
}

function contentBlurb(type: CampaignType) {
  return type === "SEARCH"
    ? "Each ad group has a theme, its keywords and a responsive search ad."
    : type === "PERFORMANCE_MAX"
      ? "Give Google text, images and signals. It assembles ads for every channel."
      : type === "SHOPPING"
        ? "Shopping ads come from your product feed."
        : "Visual ads built from your images and short copy.";
}

function Section({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-2xl font-black tracking-tight">{title}</h2>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}

function Choice({ active, onClick, title, body, footer, disabled }: { active: boolean; onClick: () => void; title: string; body: string; footer?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative rounded-2xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45",
        active ? "border-[#400095] bg-[#400095]/[0.05] shadow-sm ring-1 ring-[#400095] dark:border-violet-400 dark:ring-violet-400" : "border-border/60 hover:border-border"
      )}
    >
      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#400095] text-white dark:bg-violet-600">
          <Check className="h-3 w-3" />
        </span>
      )}
      <p className="pr-6 text-sm font-bold">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
      {footer && <div className="mt-2">{footer}</div>}
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <p className="text-xs font-semibold">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function ReviewRow({ label, children, onEdit }: { label: string; children: ReactNode; onEdit?: () => void }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <span className="w-36 shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-xs">{children}</span>
      {onEdit && (
        <button type="button" onClick={onEdit} className="text-[11px] font-semibold text-[#400095] hover:underline dark:text-violet-300">
          Edit
        </button>
      )}
    </div>
  );
}

function BiddingTarget({ type, value, onChange, currency }: { type: BiddingStrategyType; value: CampaignBundle["campaign"]["bidding"]; onChange: (b: CampaignBundle["campaign"]["bidding"]) => void; currency: string }) {
  const target = BIDDING[type].target;
  if (!target && type !== "TARGET_IMPRESSION_SHARE") return null;
  return (
    <div className="mt-5 max-w-sm">
      {target === "CPA" && (
        <Field label={`Target CPA (${currency})`} hint="Average amount you want to pay per conversion.">
          <Input type="number" value={value.targetCpa ?? ""} onChange={(e) => onChange({ ...value, targetCpa: Number(e.target.value) || undefined })} />
        </Field>
      )}
      {target === "ROAS" && (
        <Field label="Target ROAS (%)" hint="e.g. 400% = $4 of conversion value per $1 spent.">
          <Input type="number" value={value.targetRoas ? Math.round(value.targetRoas * 100) : ""} onChange={(e) => onChange({ ...value, targetRoas: Number(e.target.value) / 100 || undefined })} />
        </Field>
      )}
      {(target === "CPC" || type === "TARGET_IMPRESSION_SHARE") && (
        <Field label={`Max CPC bid limit (${currency})`} hint="Optional cap per click.">
          <Input type="number" value={value.maxCpcLimit ?? ""} onChange={(e) => onChange({ ...value, maxCpcLimit: Number(e.target.value) || undefined })} />
        </Field>
      )}
    </div>
  );
}

function StringList({ label, items, max, limit, onChange, multiline }: { label: string; items: string[]; max: number; limit: number; onChange: (v: string[]) => void; multiline?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 flex justify-between text-xs font-semibold">
        {label} <span className="text-[10px] font-normal text-muted-foreground">{items.filter(Boolean).length}/{max}</span>
      </p>
      <div className="space-y-1.5">
        {items.map((v, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <LimitedInput className="flex-1" value={v} max={limit} multiline={multiline} onChange={(t) => onChange(items.map((x, j) => (j === i ? t : x)))} />
            {items.length > 1 && (
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="mt-2 text-muted-foreground hover:text-red-600" aria-label="Remove">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {items.length < max && (
        <button type="button" onClick={() => onChange([...items, ""])} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#400095] hover:underline dark:text-violet-300">
          <Plus className="h-3 w-3" /> Add
        </button>
      )}
    </div>
  );
}

const GALLERY = ["landscape-1", "landscape-2", "square-1", "square-2", "square-3", "square-4", "portrait-1", "portrait-2"];

function ImagePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold">Images <span className="font-normal text-muted-foreground">· from your Products Gallery</span></p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {GALLERY.map((img) => {
          const on = value.includes(img);
          return (
            <button key={img} type="button" onClick={() => onChange(on ? value.filter((x) => x !== img) : [...value, img])} className={cn("relative rounded-lg ring-offset-2 ring-offset-background", on && "ring-2 ring-[#400095] dark:ring-violet-400")}>
              <ImageTile label={img} ratio={img.startsWith("landscape") ? "square" : img.startsWith("portrait") ? "square" : "square"} />
              {on && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#400095] text-white dark:bg-violet-600">
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AssetGroupEditor({ value, onChange }: { value: AssetGroupDraft; onChange: (v: AssetGroupDraft) => void }) {
  const set = <K extends keyof AssetGroupDraft>(k: K, v: AssetGroupDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Asset group name">
          <Input value={value.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Final URL">
          <Input value={value.finalUrl} onChange={(e) => set("finalUrl", e.target.value)} />
        </Field>
      </div>
      <ImagePicker value={value.imageUrls} onChange={(v) => set("imageUrls", v)} />
      <div className="grid gap-5 lg:grid-cols-2">
        <StringList label="Headlines" items={value.headlines} max={LIMITS.pmaxHeadlinesMax} limit={LIMITS.headline} onChange={(v) => set("headlines", v)} />
        <StringList label="Long headlines" items={value.longHeadlines} max={LIMITS.pmaxLongHeadlinesMax} limit={LIMITS.longHeadline} onChange={(v) => set("longHeadlines", v)} multiline />
        <StringList label="Descriptions" items={value.descriptions} max={LIMITS.pmaxDescriptionsMax} limit={LIMITS.description} onChange={(v) => set("descriptions", v)} multiline />
        <div className="space-y-3">
          <Field label="Business name">
            <LimitedInput value={value.businessName} max={25} onChange={(v) => set("businessName", v)} />
          </Field>
          <Field label="Audience signal" hint="A hint, not a limit: who's likely to convert.">
            <Input value={value.audienceSignal ?? ""} onChange={(e) => set("audienceSignal", e.target.value)} placeholder="e.g. Purchasers (180d) + In-market: Running Shoes" />
          </Field>
          <Field label="Search themes" hint="Up to 25 topics people search for, comma separated.">
            <Input value={value.searchThemes.join(", ")} onChange={(e) => set("searchThemes", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
          </Field>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">Ad strength: <span className="font-semibold">{rateAdStrength(value.headlines, value.descriptions).toLowerCase()}</span></p>
    </div>
  );
}

function VisualAdEditor({ type, draft, onChange }: { type: CampaignType; draft: AgDraft; onChange: (d: AgDraft) => void }) {
  const setHeadline = (i: number, text: string) => onChange({ ...draft, ad: { ...draft.ad, headlines: draft.ad.headlines.map((h, j) => (j === i ? { text } : h)) } });
  return (
    <div className="space-y-3">
      {type === "VIDEO" && (
        <Field label="YouTube video URL">
          <Input value={draft.extra.videoUrl} onChange={(e) => onChange({ ...draft, extra: { ...draft.extra, videoUrl: e.target.value } })} placeholder="https://youtube.com/watch?v=…" />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {draft.ad.headlines.slice(0, 3).map((h, i) => (
          <Field key={i} label={`Headline ${i + 1}`}>
            <LimitedInput value={h.text} max={LIMITS.headline} onChange={(t) => setHeadline(i, t)} />
          </Field>
        ))}
        <Field label="Long headline">
          <LimitedInput value={draft.extra.longHeadline} max={LIMITS.longHeadline} onChange={(t) => onChange({ ...draft, extra: { ...draft.extra, longHeadline: t } })} />
        </Field>
      </div>
      <Field label="Description">
        <LimitedInput value={draft.ad.descriptions[0]?.text ?? ""} max={LIMITS.description} multiline onChange={(t) => onChange({ ...draft, ad: { ...draft.ad, descriptions: [{ text: t }, ...draft.ad.descriptions.slice(1)] } })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name">
          <LimitedInput value={draft.extra.businessName} max={25} onChange={(t) => onChange({ ...draft, extra: { ...draft.extra, businessName: t } })} />
        </Field>
        <Field label="Final URL">
          <Input value={draft.ad.finalUrl} onChange={(e) => onChange({ ...draft, ad: { ...draft.ad, finalUrl: e.target.value } })} />
        </Field>
      </div>
    </div>
  );
}

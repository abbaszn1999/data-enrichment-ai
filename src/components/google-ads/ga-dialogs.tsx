"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ASSET_TYPES, AUDIENCE_KINDS, CONVERSION_CATEGORIES, LIMITS, MATCH_TYPES, SNIPPET_HEADERS } from "@/lib/google-ads/constants";
import { money } from "@/lib/google-ads/metrics";
import { gid, keywordLabel, parseKeywordLines, rateAdStrength } from "@/lib/google-ads/mutations";
import { useAccountState, useGoogleAds, type GaDialog } from "@/lib/google-ads/store";
import type { Ad, AssetType, AudienceTarget, ConversionAction, ConversionCategory, MatchType, MutateOp } from "@/lib/google-ads/types";
import { RsaEditor, emptyRsa, type RsaDraft } from "./ga-rsa-editor";
import { ACCENT_BTN, Field, LimitedInput, SelectBox, Segmented } from "./ga-ui";
import { tagSnippet } from "./views/conversions";

export function GaDialogs() {
  const dialog = useGoogleAds((s) => s.dialog);
  const closeDialog = useGoogleAds((s) => s.closeDialog);
  if (!dialog) return null;
  const wide = dialog.kind === "ad" || dialog.kind === "adGroup";
  return (
    <Dialog open onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto", wide ? "sm:max-w-5xl" : "sm:max-w-xl")}>
        <DialogBody dialog={dialog} />
      </DialogContent>
    </Dialog>
  );
}

function DialogBody({ dialog }: { dialog: GaDialog }) {
  switch (dialog.kind) {
    case "adGroup":
      return <AdGroupForm campaignId={dialog.campaignId} />;
    case "keywords":
      return <KeywordsForm adGroupId={dialog.adGroupId} />;
    case "negatives":
      return <NegativesForm campaignId={dialog.campaignId} adGroupId={dialog.adGroupId} />;
    case "ad":
      return <AdForm adGroupId={dialog.adGroupId} adId={dialog.adId} />;
    case "asset":
      return <AssetForm campaignId={dialog.campaignId} />;
    case "budget":
      return <BudgetForm campaignId={dialog.campaignId} />;
    case "audience":
      return <AudienceForm campaignId={dialog.campaignId} adGroupId={dialog.adGroupId} />;
    case "conversion":
      return <ConversionForm />;
  }
}

/** Shared submit: validate + apply, toast the outcome, close on success. */
function useSubmit() {
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const closeDialog = useGoogleAds((s) => s.closeDialog);
  return (title: string, ops: MutateOp[], keepOpen = false) => {
    const res = applyDirect(title, ops);
    if (res.ok) {
      toast.success(title);
      if (!keepOpen) closeDialog();
    } else toast.error(res.error ?? "Could not apply");
    return res.ok;
  };
}

function Footer({ children, onCancel }: { children: ReactNode; onCancel?: () => void }) {
  const closeDialog = useGoogleAds((s) => s.closeDialog);
  return (
    <DialogFooter className="gap-2">
      <button type="button" onClick={onCancel ?? closeDialog} className="rounded-lg border border-border/70 px-4 py-2 text-xs font-medium hover:bg-muted">
        Cancel
      </button>
      {children}
    </DialogFooter>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn("rounded-lg px-4 py-2 text-xs font-semibold", ACCENT_BTN)}>
      {children}
    </button>
  );
}

function KeywordBox({ value, onChange, matchType, onMatchType }: { value: string; onChange: (v: string) => void; matchType: MatchType; onMatchType: (m: MatchType) => void }) {
  const parsed = parseKeywordLines(value, matchType);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Keywords</span>
        <Segmented size="xs" value={matchType} onChange={onMatchType} options={(["BROAD", "PHRASE", "EXACT"] as MatchType[]).map((m) => ({ value: m, label: MATCH_TYPES[m].label.replace(" match", "") }))} />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder={'One per line\nrunning shoes\n"running shoes for men"\n[trail running shoes]'}
        className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <p className="text-[11px] text-muted-foreground">
        Use <code>&quot;quotes&quot;</code> for phrase and <code>[brackets]</code> for exact. Plain lines use the selected match type.
      </p>
      {parsed.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {parsed.map((k) => (
            <span key={`${k.matchType}${k.text}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              {keywordLabel(k.text, k.matchType)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Ad group ───────────────────────────────────────────────────────────────

function AdGroupForm({ campaignId }: { campaignId?: string }) {
  const data = useAccountState()!.data;
  const submit = useSubmit();
  const campaigns = data.campaigns.filter((c) => c.status !== "REMOVED" && c.type !== "PERFORMANCE_MAX");
  const [cid, setCid] = useState(campaignId && campaigns.some((c) => c.id === campaignId) ? campaignId : campaigns[0]?.id ?? "");
  const campaign = data.campaigns.find((c) => c.id === cid);
  const isSearch = campaign?.type === "SEARCH";
  const [name, setName] = useState("");
  const [bid, setBid] = useState("");
  const [kw, setKw] = useState("");
  const [match, setMatch] = useState<MatchType>("PHRASE");
  const [ad, setAd] = useState<RsaDraft>(emptyRsa(`https://${data.account.name.toLowerCase().includes("stride") ? "stride-demo.com" : "example.com"}/`));

  const create = () => {
    const adGroupId = gid("ag");
    const keywords = parseKeywordLines(kw, match).map((k) => ({ id: gid("k"), adGroupId, ...k, status: "ENABLED" as const, policy: "UNDER_REVIEW" as const }));
    const hs = ad.headlines.filter((h) => h.text.trim());
    const ds = ad.descriptions.filter((d) => d.text.trim());
    const ads: Ad[] =
      isSearch && hs.length
        ? [{ id: gid("ad"), adGroupId, type: "RESPONSIVE_SEARCH_AD", status: "ENABLED", headlines: hs, descriptions: ds, finalUrl: ad.finalUrl, path1: ad.path1 || undefined, path2: ad.path2 || undefined, adStrength: rateAdStrength(hs.map((h) => h.text), ds.map((d) => d.text), keywords.map((k) => k.text)), policy: "UNDER_REVIEW" }]
        : [];
    submit(`Create ad group ${name}`, [
      {
        kind: "adGroup.create",
        adGroup: { id: adGroupId, campaignId: cid, name: name.trim(), status: "ENABLED", type: isSearch ? "SEARCH_STANDARD" : campaign?.type === "SHOPPING" ? "SHOPPING_PRODUCT_ADS" : campaign?.type === "DEMAND_GEN" ? "DEMAND_GEN" : "DISPLAY_STANDARD", defaultCpcBid: Number(bid) || undefined },
        keywords,
        ads,
      },
    ]);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New ad group</DialogTitle>
        <DialogDescription>A theme inside a campaign, with its own keywords and ads.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Campaign">
          <SelectBox value={cid} onChange={setCid} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Ad group name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Running Shoes – Kids" />
        </Field>
        <Field label="Default max. CPC" hint={campaign?.bidding.type === "MANUAL_CPC" ? "Used when a keyword has no bid." : "Optional with automated bidding."}>
          <Input type="number" value={bid} onChange={(e) => setBid(e.target.value)} placeholder="Auto" />
        </Field>
      </div>
      {isSearch && (
        <>
          <KeywordBox value={kw} onChange={setKw} matchType={match} onMatchType={setMatch} />
          <div className="border-t border-border/60 pt-4">
            <p className="mb-3 text-sm font-bold">Responsive search ad</p>
            <RsaEditor value={ad} onChange={setAd} keywords={parseKeywordLines(kw).map((k) => k.text)} />
          </div>
        </>
      )}
      <Footer>
        <PrimaryButton onClick={create} disabled={!name.trim() || !cid}>
          Create ad group
        </PrimaryButton>
      </Footer>
    </>
  );
}

// ─── Keywords ───────────────────────────────────────────────────────────────

function useSearchAdGroups() {
  const data = useAccountState()!.data;
  return data.adGroups.filter((g) => g.type === "SEARCH_STANDARD" && g.status !== "REMOVED" && data.campaigns.find((c) => c.id === g.campaignId)?.status !== "REMOVED");
}

function adGroupOptions(data: ReturnType<typeof useAccountState>, groups: { id: string; name: string; campaignId: string }[]) {
  return groups.map((g) => ({ value: g.id, label: `${data!.data.campaigns.find((c) => c.id === g.campaignId)?.name} › ${g.name}` }));
}

function KeywordsForm({ adGroupId }: { adGroupId?: string }) {
  const acc = useAccountState();
  const groups = useSearchAdGroups();
  const submit = useSubmit();
  const [agId, setAgId] = useState(adGroupId && groups.some((g) => g.id === adGroupId) ? adGroupId : groups[0]?.id ?? "");
  const [kw, setKw] = useState("");
  const [match, setMatch] = useState<MatchType>("PHRASE");
  const [bid, setBid] = useState("");
  const parsed = parseKeywordLines(kw, match);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add keywords</DialogTitle>
        <DialogDescription>Searches that can trigger your ads in this ad group.</DialogDescription>
      </DialogHeader>
      <Field label="Ad group">
        <SelectBox value={agId} onChange={setAgId} options={adGroupOptions(acc, groups)} />
      </Field>
      <KeywordBox value={kw} onChange={setKw} matchType={match} onMatchType={setMatch} />
      <Field label="Max. CPC (optional)">
        <Input type="number" value={bid} onChange={(e) => setBid(e.target.value)} placeholder="Use ad group default" />
      </Field>
      <Footer>
        <PrimaryButton
          disabled={!parsed.length || !agId}
          onClick={() =>
            submit(`Add ${parsed.length} keyword${parsed.length > 1 ? "s" : ""}`, [
              { kind: "keyword.create", keywords: parsed.map((k) => ({ id: gid("k"), adGroupId: agId, ...k, status: "ENABLED", policy: "UNDER_REVIEW", cpcBid: Number(bid) || undefined })) },
            ])
          }
        >
          Add {parsed.length || ""} keyword{parsed.length === 1 ? "" : "s"}
        </PrimaryButton>
      </Footer>
    </>
  );
}

// ─── Negative keywords ─────────────────────────────────────────────────────

function NegativesForm({ campaignId, adGroupId }: { campaignId?: string; adGroupId?: string }) {
  const acc = useAccountState()!;
  const { data } = acc;
  const submit = useSubmit();
  const [level, setLevel] = useState<"CAMPAIGN" | "AD_GROUP" | "LIST">(adGroupId ? "AD_GROUP" : campaignId ? "CAMPAIGN" : data.negativeLists.length ? "LIST" : "CAMPAIGN");
  const campaigns = data.campaigns.filter((c) => c.status !== "REMOVED");
  const groups = data.adGroups.filter((g) => g.status !== "REMOVED");
  const options =
    level === "CAMPAIGN"
      ? campaigns.map((c) => ({ value: c.id, label: c.name }))
      : level === "AD_GROUP"
        ? adGroupOptions(acc, groups)
        : data.negativeLists.map((l) => ({ value: l.id, label: l.name }));
  const preferred = level === "CAMPAIGN" ? campaignId : level === "AD_GROUP" ? adGroupId : undefined;
  const [parent, setParent] = useState(preferred ?? options[0]?.value ?? "");
  const parentValid = options.some((o) => o.value === parent) ? parent : options[0]?.value ?? "";
  const [kw, setKw] = useState("");
  const [match, setMatch] = useState<MatchType>("EXACT");
  const parsed = parseKeywordLines(kw, match);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add negative keywords</DialogTitle>
        <DialogDescription>Stop ads from showing on these searches.</DialogDescription>
      </DialogHeader>
      <Segmented
        size="xs"
        value={level}
        onChange={(v) => {
          setLevel(v);
          setParent("");
        }}
        options={[
          { value: "CAMPAIGN", label: "Campaign" },
          { value: "AD_GROUP", label: "Ad group" },
          ...(data.negativeLists.length ? [{ value: "LIST" as const, label: "Shared list" }] : []),
        ]}
      />
      <Field label={level === "LIST" ? "List" : level === "CAMPAIGN" ? "Campaign" : "Ad group"}>
        <SelectBox value={parentValid} onChange={setParent} options={options} />
      </Field>
      <KeywordBox value={kw} onChange={setKw} matchType={match} onMatchType={setMatch} />
      <Footer>
        <PrimaryButton
          disabled={!parsed.length || !parentValid}
          onClick={() => submit(`Add ${parsed.length} negative keyword${parsed.length > 1 ? "s" : ""}`, [{ kind: "negative.create", negatives: parsed.map((k) => ({ id: gid("n"), ...k, level, parentId: parentValid })) }])}
        >
          Add negatives
        </PrimaryButton>
      </Footer>
    </>
  );
}

// ─── Ad ─────────────────────────────────────────────────────────────────────

function AdForm({ adGroupId, adId }: { adGroupId?: string; adId?: string }) {
  const acc = useAccountState()!;
  const groups = useSearchAdGroups();
  const submit = useSubmit();
  const existing = acc.data.ads.find((a) => a.id === adId);
  const [agId, setAgId] = useState(existing?.adGroupId ?? (adGroupId && groups.some((g) => g.id === adGroupId) ? adGroupId : groups[0]?.id ?? ""));
  const [ad, setAd] = useState<RsaDraft>(
    existing
      ? { headlines: existing.headlines, descriptions: existing.descriptions, finalUrl: existing.finalUrl, path1: existing.path1 ?? "", path2: existing.path2 ?? "" }
      : emptyRsa("https://stride-demo.com/")
  );
  const keywords = acc.data.keywords.filter((k) => k.adGroupId === agId && k.status === "ENABLED").map((k) => k.text);

  const save = () => {
    const hs = ad.headlines.filter((h) => h.text.trim());
    const ds = ad.descriptions.filter((d) => d.text.trim());
    const fields = {
      headlines: hs,
      descriptions: ds,
      finalUrl: ad.finalUrl,
      path1: ad.path1 || undefined,
      path2: ad.path2 || undefined,
      adStrength: rateAdStrength(hs.map((h) => h.text), ds.map((d) => d.text), keywords),
      policy: "UNDER_REVIEW" as const,
    };
    if (existing) submit("Edit responsive search ad", [{ kind: "ad.update", adId: existing.id, patch: { ...fields, policyTopics: [] } }]);
    else submit("Create responsive search ad", [{ kind: "ad.create", ads: [{ id: gid("ad"), adGroupId: agId, type: "RESPONSIVE_SEARCH_AD", status: "ENABLED", ...fields }] }]);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{existing ? "Edit responsive search ad" : "New responsive search ad"}</DialogTitle>
        <DialogDescription>Google tests combinations of your headlines and descriptions to find what works. Editing resubmits the ad for review.</DialogDescription>
      </DialogHeader>
      {!existing && (
        <Field label="Ad group">
          <SelectBox value={agId} onChange={setAgId} options={adGroupOptions(acc, groups)} />
        </Field>
      )}
      <RsaEditor value={ad} onChange={setAd} keywords={keywords} />
      <Footer>
        <PrimaryButton onClick={save} disabled={!agId}>
          {existing ? "Save and resubmit" : "Create ad"}
        </PrimaryButton>
      </Footer>
    </>
  );
}

// ─── Asset ──────────────────────────────────────────────────────────────────

const ASSET_FORM_TYPES: AssetType[] = ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "CALL", "PROMOTION", "PRICE", "IMAGE"];

function AssetForm({ campaignId }: { campaignId?: string }) {
  const data = useAccountState()!.data;
  const submit = useSubmit();
  const [type, setType] = useState<AssetType>("SITELINK");
  const [level, setLevel] = useState<"ACCOUNT" | "CAMPAIGN">(campaignId ? "CAMPAIGN" : "ACCOUNT");
  const campaigns = data.campaigns.filter((c) => c.status !== "REMOVED");
  const [cid, setCid] = useState(campaignId ?? campaigns[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [url, setUrl] = useState("https://stride-demo.com/");
  const [header, setHeader] = useState<string>("Types");
  const [values, setValues] = useState("");

  const titleMax = type === "SITELINK" || type === "CALLOUT" ? LIMITS.sitelinkText : 90;
  const lines = type === "STRUCTURED_SNIPPET" ? values.split(",").map((v) => v.trim()).filter(Boolean) : [line1, line2].filter(Boolean);
  const valid = type === "STRUCTURED_SNIPPET" ? lines.length >= 3 : title.trim().length > 0 && title.length <= titleMax;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add asset</DialogTitle>
        <DialogDescription>{ASSET_TYPES[type].blurb}.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Asset type">
          <SelectBox value={type} onChange={setType} options={ASSET_FORM_TYPES.map((t) => ({ value: t, label: ASSET_TYPES[t].label }))} />
        </Field>
        <Field label="Add to">
          <SelectBox value={level} onChange={setLevel} options={[{ value: "ACCOUNT", label: "Account (all campaigns)" }, { value: "CAMPAIGN", label: "One campaign" }]} />
        </Field>
      </div>
      {level === "CAMPAIGN" && (
        <Field label="Campaign">
          <SelectBox value={cid} onChange={setCid} options={campaigns.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
      )}
      {type === "STRUCTURED_SNIPPET" ? (
        <>
          <Field label="Header">
            <SelectBox value={header} onChange={setHeader} options={SNIPPET_HEADERS.map((h) => ({ value: h, label: h }))} />
          </Field>
          <Field label="Values" hint="At least 3, separated by commas.">
            <Input value={values} onChange={(e) => setValues(e.target.value)} placeholder="Running shoes, Leggings, Tops" />
          </Field>
        </>
      ) : (
        <>
          <Field label={type === "CALL" ? "Phone number" : type === "SITELINK" ? "Sitelink text" : type === "CALLOUT" ? "Callout text" : type === "IMAGE" ? "Image name" : "Text"}>
            <LimitedInput value={title} onChange={setTitle} max={titleMax} />
          </Field>
          {(type === "SITELINK" || type === "PROMOTION" || type === "PRICE") && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={type === "SITELINK" ? "Description line 1" : "Detail"}>
                <LimitedInput value={line1} onChange={setLine1} max={35} />
              </Field>
              <Field label={type === "SITELINK" ? "Description line 2" : "Detail"}>
                <LimitedInput value={line2} onChange={setLine2} max={35} />
              </Field>
            </div>
          )}
          {(type === "SITELINK" || type === "PROMOTION") && (
            <Field label="Final URL">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
          )}
        </>
      )}
      <Footer>
        <PrimaryButton
          disabled={!valid}
          onClick={() =>
            submit(`Add ${ASSET_TYPES[type].label.toLowerCase()}`, [
              {
                kind: "asset.create",
                assets: [
                  {
                    id: gid("as"),
                    type,
                    level,
                    parentId: level === "CAMPAIGN" ? cid : undefined,
                    status: "ENABLED",
                    policy: "UNDER_REVIEW",
                    title: type === "STRUCTURED_SNIPPET" ? header : title.trim(),
                    lines,
                    finalUrl: type === "SITELINK" || type === "PROMOTION" ? url : undefined,
                  },
                ],
              },
            ])
          }
        >
          Add asset
        </PrimaryButton>
      </Footer>
    </>
  );
}

// ─── Budget ─────────────────────────────────────────────────────────────────

function BudgetForm({ campaignId }: { campaignId: string }) {
  const data = useAccountState()!.data;
  const submit = useSubmit();
  const campaign = data.campaigns.find((c) => c.id === campaignId);
  const budget = data.budgets.find((b) => b.id === campaign?.budgetId);
  const [amount, setAmount] = useState(String(budget?.amount ?? ""));
  const cur = data.account.currency;
  const limited = campaign?.servingIssues.includes("LIMITED_BY_BUDGET");
  const recommended = budget ? Math.round(budget.amount * 1.55) : 0;
  if (!campaign || !budget) return null;
  const n = Number(amount);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Budget · {campaign.name}</DialogTitle>
        <DialogDescription>Average daily amount. Google may spend up to 2× on busy days, but never more than 30.4× in a month.</DialogDescription>
      </DialogHeader>
      <Field label={`Daily budget (${cur})`}>
        <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-muted-foreground">Monthly maximum</p>
          <p className="text-base font-bold">{money((n || 0) * 30.4, cur)}</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <p className="text-muted-foreground">Change</p>
          <p className={cn("text-base font-bold", n > budget.amount ? "text-emerald-600" : n < budget.amount ? "text-red-600" : "")}>
            {n ? `${n >= budget.amount ? "+" : ""}${money(n - budget.amount, cur)}/day` : "—"}
          </p>
        </div>
      </div>
      {limited && (
        <button type="button" onClick={() => setAmount(String(recommended))} className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-left text-xs">
          <span className="font-semibold">Limited by budget.</span> Recommended: <span className="font-bold">{money(recommended, cur)}/day</span> to capture most missed impressions. Click to use.
        </button>
      )}
      <Footer>
        <PrimaryButton disabled={!(n >= 1) || n === budget.amount} onClick={() => submit(`Budget ${campaign.name}: ${money(n, cur)}/day`, [{ kind: "budget.update", budgetId: budget.id, amount: n }])}>
          Save budget
        </PrimaryButton>
      </Footer>
    </>
  );
}

// ─── Audience ───────────────────────────────────────────────────────────────

function AudienceForm({ campaignId, adGroupId }: { campaignId?: string; adGroupId?: string }) {
  const acc = useAccountState()!;
  const { data } = acc;
  const submit = useSubmit();
  const [level, setLevel] = useState<AudienceTarget["level"]>(adGroupId ? "AD_GROUP" : "CAMPAIGN");
  const campaigns = data.campaigns.filter((c) => c.status !== "REMOVED");
  const groups = data.adGroups.filter((g) => g.status !== "REMOVED");
  const [parent, setParent] = useState((level === "AD_GROUP" ? adGroupId : campaignId) ?? "");
  const options = level === "CAMPAIGN" ? campaigns.map((c) => ({ value: c.id, label: c.name })) : adGroupOptions(acc, groups);
  const parentValid = options.some((o) => o.value === parent) ? parent : options[0]?.value ?? "";
  const [segmentId, setSegmentId] = useState(data.audiences[0]?.id ?? "");
  const [mode, setMode] = useState<AudienceTarget["mode"]>("OBSERVATION");
  const [bid, setBid] = useState("");
  const seg = data.audiences.find((s) => s.id === segmentId);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add audience segment</DialogTitle>
        <DialogDescription>Observe how a segment performs, or limit ads to it.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Add to">
          <SelectBox value={level} onChange={(v) => { setLevel(v); setParent(""); }} options={[{ value: "CAMPAIGN", label: "Campaign" }, { value: "AD_GROUP", label: "Ad group" }]} />
        </Field>
        <Field label={level === "CAMPAIGN" ? "Campaign" : "Ad group"}>
          <SelectBox value={parentValid} onChange={setParent} options={options} />
        </Field>
      </div>
      <Field label="Segment" hint={seg ? AUDIENCE_KINDS[seg.kind].blurb : undefined}>
        <SelectBox value={segmentId} onChange={setSegmentId} options={data.audiences.map((s) => ({ value: s.id, label: `${s.name} · ${AUDIENCE_KINDS[s.kind].label}` }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Setting">
          <SelectBox value={mode} onChange={setMode} options={[{ value: "OBSERVATION", label: "Observation (recommended)" }, { value: "TARGETING", label: "Targeting" }, { value: "EXCLUSION", label: "Exclusion" }]} />
        </Field>
        <Field label="Bid adjustment (%)" hint="Optional, manual bidding only.">
          <Input type="number" value={bid} onChange={(e) => setBid(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <Footer>
        <PrimaryButton
          disabled={!parentValid || !segmentId}
          onClick={() => submit(`Add audience ${seg?.name}`, [{ kind: "audience.attach", targets: [{ id: gid("at"), segmentId, level, parentId: parentValid, mode, bidModifier: Number(bid) / 100 || undefined }] }])}
        >
          Add segment
        </PrimaryButton>
      </Footer>
    </>
  );
}

// ─── Conversion action ─────────────────────────────────────────────────────

function ConversionForm() {
  const data = useAccountState()!.data;
  const submit = useSubmit();
  const closeDialog = useGoogleAds((s) => s.closeDialog);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ConversionCategory>("PURCHASE");
  const [value, setValue] = useState<"DYNAMIC" | "SAME" | "NONE">("DYNAMIC");
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState<ConversionAction["countingType"]>("MANY_PER_CLICK");
  const [primary, setPrimary] = useState(true);
  const [created, setCreated] = useState<ConversionAction | null>(null);

  const action = useMemo<ConversionAction>(
    () => ({
      id: gid("conv"),
      name: name.trim(),
      category,
      source: "WEBSITE",
      status: "UNVERIFIED",
      primary,
      countingType: count,
      useDynamicValue: value === "DYNAMIC",
      defaultValue: value === "SAME" ? Number(amount) || undefined : undefined,
      clickThroughWindowDays: 30,
      attribution: "DATA_DRIVEN",
      conversions30d: 0,
    }),
    [name, category, primary, count, value, amount]
  );

  if (created) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Install the tag · {created.name}</DialogTitle>
          <DialogDescription>Add this to your site. The action shows as Unverified until the first conversion arrives.</DialogDescription>
        </DialogHeader>
        <pre className="max-h-72 overflow-auto rounded-xl bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">{tagSnippet(data.account.customerId, created)}</pre>
        <Footer onCancel={closeDialog}>
          <PrimaryButton
            onClick={() => {
              navigator.clipboard?.writeText(tagSnippet(data.account.customerId, created));
              toast.success("Tag copied");
              closeDialog();
            }}
          >
            Copy and close
          </PrimaryButton>
        </Footer>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New conversion action</DialogTitle>
        <DialogDescription>Track a website action as a conversion.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Purchase" />
        </Field>
        <Field label="Category">
          <SelectBox value={category} onChange={setCategory} options={(Object.keys(CONVERSION_CATEGORIES) as ConversionCategory[]).map((c) => ({ value: c, label: CONVERSION_CATEGORIES[c] }))} />
        </Field>
      </div>
      <Field label="Value">
        <SelectBox
          value={value}
          onChange={setValue}
          options={[
            { value: "DYNAMIC", label: "Use different values for each conversion (order total)" },
            { value: "SAME", label: "Use the same value for each conversion" },
            { value: "NONE", label: "Don't use a value" },
          ]}
        />
      </Field>
      {value === "SAME" && (
        <Field label={`Value (${data.account.currency})`}>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Count" hint="Every for purchases, One for leads.">
          <SelectBox value={count} onChange={setCount} options={[{ value: "MANY_PER_CLICK", label: "Every" }, { value: "ONE_PER_CLICK", label: "One" }]} />
        </Field>
        <Field label="Goal type">
          <SelectBox value={primary ? "P" : "S"} onChange={(v) => setPrimary(v === "P")} options={[{ value: "P", label: "Primary (used for bidding)" }, { value: "S", label: "Secondary (report only)" }]} />
        </Field>
      </div>
      <Footer>
        <PrimaryButton
          disabled={!name.trim()}
          onClick={() => {
            if (submit(`Create conversion action ${action.name}`, [{ kind: "conversion.create", action }], true)) setCreated(action);
          }}
        >
          Create and get tag
        </PrimaryButton>
      </Footer>
    </>
  );
}

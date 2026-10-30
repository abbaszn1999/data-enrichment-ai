"use client";

import { Check, KeyRound, Lock, Megaphone, RefreshCw, ShoppingBag, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCustomerId } from "@/lib/google-ads/metrics";
import { MERCHANT_SCOPE, merchantLinkState } from "@/lib/google-ads/merchant";
import { useGoogleAds } from "@/lib/google-ads/store";
import { Card, Pill, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs font-semibold hover:bg-muted";
const BTN_PRIMARY = "inline-flex items-center gap-1.5 rounded-lg bg-[#400095] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#340079] dark:bg-[#F76D01] dark:hover:bg-[#d85f00]";

/**
 * Where the user reviews and changes what is connected. Google Ads and Merchant
 * Center are separate connections, each with its own sign-in and account, so
 * Merchant Center can be connected, switched or reconnected at any time.
 */
export function ConnectionsView() {
  const { data } = useGa();
  const email = useGoogleAds((s) => s.googleEmail);
  const merchant = useGoogleAds((s) => s.merchant);
  const setView = useGoogleAds((s) => s.setView);
  const setScope = useGoogleAds((s) => s.setScope);
  const disconnect = useGoogleAds((s) => s.disconnect);
  const startConnect = useGoogleAds((s) => s.startConnect);
  const startMerchantConnect = useGoogleAds((s) => s.startMerchantConnect);
  const changeMerchantAccount = useGoogleAds((s) => s.changeMerchantAccount);
  const disconnectMerchant = useGoogleAds((s) => s.disconnectMerchant);

  const mc = merchant.accounts.find((a) => a.merchantId === merchant.merchantId);
  const link = mc ? merchantLinkState(data.account.merchantCenterId, mc.merchantId) : null;

  const reconnectAds = () => {
    disconnect();
    startConnect();
  };

  return (
    <div className="space-y-4">
      <ViewHeader title="Connections" subtitle="Review what the agent can reach. This workspace uses one ad account. Google Ads and Merchant Center are connected separately, so you can change or reconnect either one at any time." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300">
              <Megaphone className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Google Ads</p>
              <p className="text-[11px] text-muted-foreground">Campaigns, keywords, ads, assets, audiences and reports.</p>
            </div>
            <Pill tone="good">Connected</Pill>
          </div>
          <dl className="space-y-2 text-xs">
            <Row k="Signed in as" v={email ?? "-"} />
            <Row k="Ad account" v={`${data.account.name} · ${formatCustomerId(data.account.customerId)}`} />
            <Row k="Access" v={<code className="rounded bg-muted px-1 text-[10px]">{ADS_SCOPE}</code>} />
          </dl>
          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
            <button type="button" onClick={reconnectAds} className={BTN}>
              <RefreshCw className="h-3 w-3" /> Reconnect
            </button>
            <button type="button" onClick={disconnect} className={cn(BTN, "text-red-600")}>
              <Unplug className="h-3 w-3" /> Disconnect
            </button>
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F76D01]/10 text-[#F76D01]">
              <ShoppingBag className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Google Merchant Center</p>
              <p className="text-[11px] text-muted-foreground">Your product feed: statuses, issues and fixes.</p>
            </div>
            {mc ? <Pill tone="good">Connected</Pill> : <Pill tone="neutral">Not connected</Pill>}
          </div>

          {mc ? (
            <>
              <dl className="space-y-2 text-xs">
                <Row k="Signed in as" v={merchant.email ?? "-"} />
                <Row k="Account" v={`${mc.name} · ${mc.merchantId}`} />
                <Row k="Store" v={`${mc.website} · ${mc.country}`} />
                <Row k="Access" v={<code className="rounded bg-muted px-1 text-[10px]">{MERCHANT_SCOPE}</code>} />
                <Row
                  k="Linked to this ad account"
                  v={
                    link === "LINKED" ? (
                      <Pill tone="good">Yes</Pill>
                    ) : link === "OTHER" ? (
                      <Pill tone="warn">Linked to {data.account.merchantCenterId}</Pill>
                    ) : (
                      <Pill tone="warn">Not linked</Pill>
                    )
                  }
                />
              </dl>
              {link !== "LINKED" && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                  {link === "OTHER"
                    ? "This ad account is linked to a different Merchant Center account, so Shopping campaigns here use that feed."
                    : "This ad account isn't linked to Merchant Center yet, so Shopping and feed-based Performance Max can't use these products."}{" "}
                  <button type="button" onClick={() => { setScope({}); setView("links"); }} className="font-semibold underline">
                    Open Linked accounts
                  </button>
                </p>
              )}
              <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                <button type="button" onClick={changeMerchantAccount} className={BTN}>
                  Change account
                </button>
                <button type="button" onClick={startMerchantConnect} className={BTN}>
                  <RefreshCw className="h-3 w-3" /> Reconnect
                </button>
                <button type="button" onClick={disconnectMerchant} className={cn(BTN, "text-red-600")}>
                  <Unplug className="h-3 w-3" /> Disconnect
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Optional. Connect it so the agent can read every product&apos;s status and send fixes (titles, GTINs, prices) back to Merchant Center, always after you approve.
              </p>
              <div className="border-t border-border/60 pt-3">
                <button type="button" onClick={startMerchantConnect} className={BTN_PRIMARY}>
                  <ShoppingBag className="h-3.5 w-3.5" /> Connect Merchant Center
                </button>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold">
          <KeyRound className="h-4 w-4 text-muted-foreground" /> What the agent can use right now
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <Access
            on
            title="Google Ads tools"
            body="Reports, campaign structure, search terms, recommendations, conversions, Keyword Planner. Changes wait for your approval."
          />
          <Access
            on={!!mc}
            title="Merchant Center tools"
            body={mc ? "Read product statuses and issues, propose feed fixes. Fixes wait for your approval." : "Locked until Merchant Center is connected. The agent can still see product status that Google Ads reports."}
          />
        </div>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
    </div>
  );
}

function Access({ on, title, body }: { on: boolean; title: string; body: string }) {
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3", on ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60 bg-muted/30")}>
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", on ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground")}>
        {on ? <Check className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
      </span>
      <div>
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

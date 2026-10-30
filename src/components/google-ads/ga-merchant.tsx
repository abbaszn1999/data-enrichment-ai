"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Check, ChevronRight, Eye, Loader2, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEMO_GOOGLE_EMAIL } from "@/lib/google-ads/mock-data";
import { MERCHANT_SCOPE, merchantLinkState } from "@/lib/google-ads/merchant";
import { useAccountData, useGoogleAds } from "@/lib/google-ads/store";
import { GoogleMark } from "./ga-connect";

/**
 * Merchant Center connection flow (simulated): Google sign-in, consent for the
 * `content` scope, then pick the Merchant Center account. Rendered at the top of
 * the shell so it works from the connect screen and from Connections.
 */
export function MerchantConnectDialog() {
  const status = useGoogleAds((s) => s.merchant.status);
  if (status === "authorizing") return <MerchantConsent />;
  if (status === "selecting") return <MerchantPicker />;
  return null;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" data-testid="merchant-dialog">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        {children}
      </motion.div>
    </div>
  );
}

function MerchantConsent() {
  const complete = useGoogleAds((s) => s.completeMerchantAuth);
  const cancel = useGoogleAds((s) => s.cancelMerchantConnect);
  const [step, setStep] = useState<"choose" | "consent" | "loading">("choose");

  const allow = () => {
    setStep("loading");
    window.setTimeout(complete, 900);
  };

  return (
    <Frame>
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3 text-xs text-muted-foreground">
        <GoogleMark className="h-4 w-4" /> Sign in with Google
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase">Simulated</span>
      </div>
      {step === "choose" ? (
        <div className="p-6">
          <h2 className="text-xl font-semibold">Choose an account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            to connect <span className="font-medium text-foreground">Merchant Center</span> to Autommerce
          </p>
          <button
            type="button"
            onClick={() => setStep("consent")}
            className="mt-5 flex w-full items-center gap-3 rounded-xl border border-border/70 px-4 py-3 text-left hover:bg-muted/50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#400095] text-sm font-bold text-white">M</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Marketing team</span>
              <span className="block truncate text-xs text-muted-foreground">{DEMO_GOOGLE_EMAIL}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          <button type="button" onClick={cancel} className="mt-6 text-sm font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      ) : (
        <div className="p-6">
          <h2 className="text-lg font-semibold leading-snug">Autommerce wants access to your Google Account</h2>
          <p className="mt-1 text-xs text-muted-foreground">{DEMO_GOOGLE_EMAIL}</p>
          <div className="mt-5 rounded-xl border border-border/70 p-4">
            <p className="text-xs font-semibold">This will allow Autommerce to:</p>
            <div className="mt-3 flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4285F4]/10">
                <Eye className="h-4 w-4 text-[#4285F4]" />
              </span>
              <p className="text-sm">See and manage your product listings and Merchant Center account settings.</p>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Scope: <code className="rounded bg-muted px-1">{MERCHANT_SCOPE}</code>. This is separate from Google Ads access. You can remove it any time from Connections or in
            your Google Account.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={cancel} className="rounded-lg px-4 py-2 text-sm font-medium text-[#4285F4] hover:bg-[#4285F4]/10">
              Cancel
            </button>
            <button
              type="button"
              disabled={step === "loading"}
              onClick={allow}
              className="inline-flex items-center gap-2 rounded-lg bg-[#4285F4] px-5 py-2 text-sm font-medium text-white hover:bg-[#3367d6] disabled:opacity-70"
            >
              {step === "loading" && <Loader2 className="h-4 w-4 animate-spin" />} Allow
            </button>
          </div>
        </div>
      )}
    </Frame>
  );
}

function MerchantPicker() {
  const merchant = useGoogleAds((s) => s.merchant);
  const select = useGoogleAds((s) => s.selectMerchantAccount);
  const cancel = useGoogleAds((s) => s.cancelMerchantConnect);
  const startAgain = useGoogleAds((s) => s.startMerchantConnect);
  const adsData = useAccountData();
  const adsName = adsData?.account.name;

  return (
    <Frame>
      <div className="p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
            <Check className="h-5 w-5 text-emerald-600" />
          </span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Choose a Merchant Center account</h2>
            <p className="text-xs text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{merchant.email}</span>
            </p>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60">
          {merchant.accounts.map((a) => {
            const link = adsData ? merchantLinkState(adsData.account.merchantCenterId, a.merchantId) : null;
            return (
              <button
                key={a.merchantId}
                type="button"
                onClick={() => select(a.merchantId)}
                className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-3 text-left last:border-b-0 hover:bg-muted/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F76D01]/10 text-[#F76D01]">
                  <ShoppingBag className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{a.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {a.merchantId} · {a.website} · {a.country}
                  </span>
                </span>
                {link === "LINKED" && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Linked to {adsName}</span>
                )}
                {link && link !== "LINKED" && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400")}>
                    <AlertTriangle className="h-3 w-3" /> Not linked
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <button type="button" onClick={cancel} className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button type="button" onClick={startAgain} className="text-xs text-muted-foreground hover:text-foreground">
            Use a different Google account
          </button>
        </div>
      </div>
    </Frame>
  );
}

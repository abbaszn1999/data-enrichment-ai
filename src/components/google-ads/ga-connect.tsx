"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  Check,
  ChevronRight,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  Megaphone,
  PenLine,
  ShieldCheck,
  ShoppingBag,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCustomerId } from "@/lib/google-ads/metrics";
import { useGoogleAds } from "@/lib/google-ads/store";

export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}

const CAN = [
  { icon: BarChart3, title: "Read reports", body: "Campaign, keyword, search-term and conversion data." },
  { icon: PenLine, title: "Propose and make changes", body: "Budgets, bids, keywords, ads and new campaigns, only after you approve." },
  { icon: Undo2, title: "Undo what it changed", body: "Every change is logged with a one-click undo." },
];

const CANNOT = ["See or change billing and payment methods", "Spend beyond the budgets you approve", "Access other Google products"];

export function GaConnect() {
  const status = useGoogleAds((s) => s.status);
  if (status === "selecting") return <AccountPicker />;
  return (
    <div className="autommerce-dashboard flex-1 overflow-auto bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-72 w-72 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                <Megaphone className="h-4 w-4" />
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">Agents · Google Ads</span>
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">Preview · demo data</span>
            </div>
            <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-5xl">
              Your Google Ads,
              <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">run by an agent.</span>
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground">
              Connect your account and manage everything in one place: campaigns, ad groups, keywords, ads, assets, audiences and
              conversions. Ask the agent to analyse, fix or build. It prepares the change, you approve it.
            </p>
            <ConnectionTiles />
            <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Secure Google sign-in (OAuth). We never see your password.
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-xl shadow-black/[0.04] backdrop-blur"
          >
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">What the agent can do</p>
            <div className="space-y-3">
              {CAN.map((c) => (
                <div key={c.title} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300">
                    <c.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{c.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-2xl bg-muted/50 p-3">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">It can never</p>
              {CANNOT.map((c) => (
                <p key={c} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {c}
                </p>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-4 px-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { n: "1", icon: KeyRound, title: "Sign in with Google", body: "Pick the Google account that has access to your Ads account and allow access." },
          { n: "2", icon: Building2, title: "Choose the ad account", body: "We list every account you can reach, including the ones under a manager (MCC)." },
          { n: "3", icon: ShoppingBag, title: "Merchant Center (optional)", body: "Connect your product feed so the agent can fix product issues. You can add it later." },
          { n: "4", icon: Bot, title: "Work with the agent", body: "Ask in chat, review proposed changes on the right, approve to apply." },
        ].map((s) => (
          <div key={s.n} className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">{s.n}</span>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      {status === "authorizing" && <ConsentDialog />}
    </div>
  );
}

const CONNECT_BTN =
  "inline-flex h-11 items-center gap-2.5 rounded-xl border border-border bg-background px-5 text-sm font-semibold shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md";

function TileLink({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("text-[11px] font-medium hover:underline", danger ? "text-red-600" : "text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}

/**
 * Two separate connections. Google Ads is required: "Go to agent" appears once it
 * is connected. Merchant Center is optional and can be connected or changed
 * later from Connections inside the workspace.
 */
function ConnectionTiles() {
  const status = useGoogleAds((s) => s.status);
  const customerId = useGoogleAds((s) => s.customerId);
  const accessible = useGoogleAds((s) => s.accessible);
  const merchant = useGoogleAds((s) => s.merchant);
  const startConnect = useGoogleAds((s) => s.startConnect);
  const changeAccount = useGoogleAds((s) => s.changeAccount);
  const disconnect = useGoogleAds((s) => s.disconnect);
  const enterWorkspace = useGoogleAds((s) => s.enterWorkspace);
  const startMerchantConnect = useGoogleAds((s) => s.startMerchantConnect);
  const changeMerchantAccount = useGoogleAds((s) => s.changeMerchantAccount);
  const disconnectMerchant = useGoogleAds((s) => s.disconnectMerchant);

  const adsAccount = status === "connected" ? accessible.find((a) => a.customerId === customerId) : undefined;
  const merchantAccount = merchant.accounts.find((a) => a.merchantId === merchant.merchantId);

  const tile = "flex flex-wrap items-center gap-3 rounded-2xl border bg-background/80 p-3 pr-4 shadow-sm";
  const iconBox = (done: boolean, children: React.ReactNode) => (
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", done ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground")}>
      {done ? <Check className="h-5 w-5" /> : children}
    </span>
  );

  return (
    <div className="mt-6 max-w-lg space-y-2.5">
      <div className={cn(tile, adsAccount ? "border-emerald-500/40" : "border-border/70")} data-testid="connect-ads">
        {iconBox(!!adsAccount, <Megaphone className="h-5 w-5" />)}
        {adsAccount ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Google Ads connected</p>
              <p className="truncate text-xs text-muted-foreground">
                {adsAccount.name} · {formatCustomerId(adsAccount.customerId)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <TileLink onClick={changeAccount}>Change account</TileLink>
              <TileLink onClick={disconnect} danger>Disconnect</TileLink>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Google Ads</p>
              <p className="text-xs text-muted-foreground">Required. Campaigns, keywords, ads and reports.</p>
            </div>
            <button type="button" onClick={startConnect} className={CONNECT_BTN}>
              <GoogleMark className="h-5 w-5" />
              Connect Google Ads
            </button>
          </>
        )}
      </div>

      <div className={cn(tile, merchantAccount ? "border-emerald-500/40" : "border-border/70")} data-testid="connect-merchant">
        {iconBox(!!merchantAccount, <ShoppingBag className="h-5 w-5" />)}
        {merchantAccount ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Merchant Center connected</p>
              <p className="truncate text-xs text-muted-foreground">
                {merchantAccount.name} · {merchantAccount.merchantId}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <TileLink onClick={changeMerchantAccount}>Change account</TileLink>
              <TileLink onClick={disconnectMerchant} danger>Disconnect</TileLink>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                Merchant Center
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Optional</span>
              </p>
              <p className="text-xs text-muted-foreground">Product feed. Lets the agent fix product issues.</p>
            </div>
            <button type="button" onClick={startMerchantConnect} className={CONNECT_BTN}>
              <GoogleMark className="h-5 w-5" />
              Connect Merchant Center
            </button>
          </>
        )}
      </div>

      {adsAccount && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="pt-1.5">
          <button
            type="button"
            onClick={enterWorkspace}
            className="inline-flex h-12 items-center gap-2.5 rounded-xl bg-[#400095] px-6 text-sm font-bold text-white shadow-[0_10px_30px_rgba(64,0,149,.28)] transition-all hover:-translate-y-0.5 hover:bg-[#340079] dark:bg-[#F76D01] dark:hover:bg-[#d85f00]"
          >
            Go to agent <ArrowRight className="h-4 w-4" />
          </button>
          {!merchantAccount && (
            <p className="mt-2 text-[11px] text-muted-foreground">You can start now. Connect Merchant Center any time from Connections inside the agent.</p>
          )}
        </motion.div>
      )}
    </div>
  );
}

/** Mimics Google's OAuth consent screen for the adwords scope. */
function ConsentDialog() {
  const completeAuth = useGoogleAds((s) => s.completeAuth);
  const disconnect = useGoogleAds((s) => s.disconnect);
  const [step, setStep] = useState<"choose" | "consent" | "loading">("choose");

  const allow = () => {
    setStep("loading");
    window.setTimeout(completeAuth, 900);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3 text-xs text-muted-foreground">
          <GoogleMark className="h-4 w-4" /> Sign in with Google
          <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase">Simulated</span>
        </div>
        {step === "choose" && (
          <div className="p-6">
            <h2 className="text-xl font-semibold">Choose an account</h2>
            <p className="mt-1 text-sm text-muted-foreground">to continue to <span className="font-medium text-foreground">Autommerce</span></p>
            <button
              type="button"
              onClick={() => setStep("consent")}
              className="mt-5 flex w-full items-center gap-3 rounded-xl border border-border/70 px-4 py-3 text-left hover:bg-muted/50"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#400095] text-sm font-bold text-white">M</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Marketing team</span>
                <span className="block truncate text-xs text-muted-foreground">marketing@stride-demo.com</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <button type="button" onClick={disconnect} className="mt-6 text-sm font-medium text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        )}
        {step !== "choose" && (
          <div className="p-6">
            <h2 className="text-lg font-semibold leading-snug">Autommerce wants access to your Google Account</h2>
            <p className="mt-1 text-xs text-muted-foreground">marketing@stride-demo.com</p>
            <div className="mt-5 rounded-xl border border-border/70 p-4">
              <p className="text-xs font-semibold">This will allow Autommerce to:</p>
              <div className="mt-3 flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4285F4]/10">
                  <Eye className="h-4 w-4 text-[#4285F4]" />
                </span>
                <p className="text-sm">See, edit, create and delete your Google Ads accounts and data.</p>
              </div>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              Scope: <code className="rounded bg-muted px-1">https://www.googleapis.com/auth/adwords</code>. You can remove access any time in your
              Google Account or from Autommerce settings. Autommerce never touches billing.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={disconnect} className="rounded-lg px-4 py-2 text-sm font-medium text-[#4285F4] hover:bg-[#4285F4]/10">
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
      </motion.div>
    </div>
  );
}

function AccountPicker() {
  const accessible = useGoogleAds((s) => s.accessible);
  const accounts = useGoogleAds((s) => s.accounts);
  const email = useGoogleAds((s) => s.googleEmail);
  const chooseAccount = useGoogleAds((s) => s.chooseAccount);
  const disconnect = useGoogleAds((s) => s.disconnect);
  const current = useGoogleAds((s) => s.customerId);
  const manager = accessible.find((a) => a.isManager);
  const clients = accessible.filter((a) => !a.isManager);

  return (
    <div className="autommerce-dashboard flex flex-1 items-start justify-center overflow-auto bg-background px-4 py-12 [font-family:var(--brand-font)]">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10">
            <Check className="h-6 w-6 text-emerald-600" />
          </span>
          <h1 className="text-2xl font-black tracking-tight">Choose an ad account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{email}</span>. The agent works on one account at a time; you can switch later.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          {manager && (
            <div className="flex items-center gap-3 border-b border-border/60 bg-muted/40 px-4 py-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{manager.name}</p>
                <p className="text-[11px] text-muted-foreground">Manager account · {formatCustomerId(manager.customerId)}</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">MCC</span>
            </div>
          )}
          {clients.map((acc) => {
            const data = accounts[acc.customerId]?.data;
            const count = data?.campaigns.length ?? 0;
            return (
              <button
                key={acc.customerId}
                type="button"
                onClick={() => chooseAccount(acc.customerId)}
                className={cn("flex w-full items-center gap-3 border-b border-border/40 px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/40", manager && "pl-9")}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300">
                  <Megaphone className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{acc.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {formatCustomerId(acc.customerId)} · {acc.currency} · {acc.timeZone}
                  </span>
                </span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", count ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                  {count ? `${count} campaigns` : "No campaigns yet"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-center gap-4">
          {current && (
            <button type="button" onClick={() => chooseAccount(current)} className="text-xs text-muted-foreground hover:text-foreground">
              Back
            </button>
          )}
          <button type="button" onClick={disconnect} className="text-xs text-muted-foreground hover:text-foreground">
            Use a different Google account
          </button>
        </div>
      </motion.div>
    </div>
  );
}

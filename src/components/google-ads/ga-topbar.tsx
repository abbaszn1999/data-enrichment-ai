"use client";

import {
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Megaphone,
  MessageSquare,
  Plug,
  Plus,
  Settings,
  Unplug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CAMPAIGN_TYPES, DATE_PRESETS } from "@/lib/google-ads/constants";
import { formatCustomerId, formatRange } from "@/lib/google-ads/metrics";
import { useAccountState, useGoogleAds } from "@/lib/google-ads/store";
import type { DateRangePreset } from "@/lib/google-ads/types";
import { ACCENT_BTN, StatusDot, Toggle } from "./ga-ui";

export function GaTopbar() {
  const acc = useAccountState();
  const accessible = useGoogleAds((s) => s.accessible);
  const accounts = useGoogleAds((s) => s.accounts);
  const selectAccount = useGoogleAds((s) => s.selectAccount);
  const disconnect = useGoogleAds((s) => s.disconnect);
  const scope = useGoogleAds((s) => s.scope);
  const setScope = useGoogleAds((s) => s.setScope);
  const range = useGoogleAds((s) => s.range);
  const setRange = useGoogleAds((s) => s.setRange);
  const setView = useGoogleAds((s) => s.setView);
  const autoApprove = useGoogleAds((s) => s.autoApprove);
  const setAutoApprove = useGoogleAds((s) => s.setAutoApprove);
  const chatOpen = useGoogleAds((s) => s.chatOpen);
  const setChatOpen = useGoogleAds((s) => s.setChatOpen);
  const openEditor = useGoogleAds((s) => s.openEditor);
  const openDialog = useGoogleAds((s) => s.openDialog);
  const email = useGoogleAds((s) => s.googleEmail);
  const merchantConnected = useGoogleAds((s) => !!s.merchant.merchantId);
  if (!acc) return null;
  const { data } = acc;

  const campaign = data.campaigns.find((c) => c.id === scope.campaignId);
  const adGroup = data.adGroups.find((g) => g.id === scope.adGroupId);
  const pending = acc.changes.filter((c) => c.status === "PENDING").length;
  const unread = data.alerts.filter((a) => !a.read).length;
  const isSearch = !campaign || campaign.type === "SEARCH";

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3">
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs font-medium hover:bg-muted"
        >
          <MessageSquare className="h-3.5 w-3.5" /> Agent
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300">
            <Megaphone className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 text-left">
            <span className="block max-w-52 truncate text-xs font-semibold">{data.account.name}</span>
            <span className="block text-[10px] text-muted-foreground">{formatCustomerId(data.account.customerId)}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">{email}</DropdownMenuLabel>
          {accessible
            .filter((a) => !a.isManager)
            .map((a) => (
              <DropdownMenuItem key={a.customerId} onSelect={() => selectAccount(a.customerId)} className="gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{a.name}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {formatCustomerId(a.customerId)} · {accounts[a.customerId]?.data.campaigns.length ?? 0} campaigns
                  </span>
                </span>
                {a.customerId === data.account.customerId && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { setScope({}); setView("allAccounts"); }} className="gap-2 text-xs">
            <Building2 className="h-3.5 w-3.5" /> All accounts (manager view)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { setScope({}); setView("connections"); }} className="gap-2 text-xs">
            <Plug className="h-3.5 w-3.5" />
            <span className="flex-1">Connections</span>
            <span className={cn("text-[10px]", merchantConnected ? "text-emerald-600" : "text-muted-foreground")}>
              {merchantConnected ? "Merchant Center on" : "Merchant Center off"}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={disconnect} className="gap-2 text-xs text-red-600">
            <Unplug className="h-3.5 w-3.5" /> Disconnect Google Ads
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="hidden min-w-0 items-center gap-1 text-xs md:flex">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        <button
          type="button"
          onClick={() => setScope({})}
          className={cn("shrink-0 rounded-md px-1.5 py-0.5 hover:bg-muted", !campaign ? "font-semibold" : "text-muted-foreground")}
        >
          All campaigns
        </button>
        {campaign && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <button
              type="button"
              onClick={() => setScope({ campaignId: campaign.id })}
              className={cn("flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted", !adGroup ? "font-semibold" : "text-muted-foreground")}
            >
              <StatusDot status={campaign.status} className="h-2 w-2 ring-0" />
              <span className="truncate">{campaign.name}</span>
              <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-semibold uppercase text-muted-foreground">{CAMPAIGN_TYPES[campaign.type].short}</span>
            </button>
          </>
        )}
        {adGroup && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <span className="flex min-w-0 items-center gap-1.5 px-1.5 font-semibold">
              <StatusDot status={adGroup.status} className="h-2 w-2 ring-0" />
              <span className="truncate">{adGroup.name}</span>
            </span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs hover:bg-muted">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="hidden font-medium lg:inline">{DATE_PRESETS[range.preset].label}</span>
            <span className="text-muted-foreground">{formatRange(range)}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.keys(DATE_PRESETS) as DateRangePreset[]).map((p) => (
              <DropdownMenuItem key={p} onSelect={() => setRange(p)} className="gap-2 text-xs">
                {DATE_PRESETS[p].label}
                {range.preset === p && <Check className="ml-auto h-3.5 w-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", ACCENT_BTN)}>
            <Plus className="h-3.5 w-3.5" /> Create
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => openEditor()} className="text-xs font-medium">New campaign</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openDialog({ kind: "adGroup", campaignId: scope.campaignId })} disabled={!data.campaigns.length} className="text-xs">
              Ad group
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openDialog({ kind: "ad", adGroupId: scope.adGroupId })} disabled={!data.adGroups.length} className="text-xs">
              Responsive search ad
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openDialog({ kind: "keywords", adGroupId: scope.adGroupId })} disabled={!data.adGroups.length || !isSearch} className="text-xs">
              Keywords
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openDialog({ kind: "negatives", campaignId: scope.campaignId, adGroupId: scope.adGroupId })} disabled={!data.campaigns.length} className="text-xs">
              Negative keywords
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openDialog({ kind: "asset", campaignId: scope.campaignId })} className="text-xs">
              Asset (sitelink, callout…)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openDialog({ kind: "audience", campaignId: scope.campaignId, adGroupId: scope.adGroupId })} disabled={!data.campaigns.length} className="text-xs">
              Audience segment
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => openDialog({ kind: "conversion" })} className="text-xs">
              Conversion action
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={() => { setScope({}); setView("rules"); }}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 hover:bg-muted"
          title="Alerts"
        >
          <Bell className="h-3.5 w-3.5" />
          {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F76D01] px-1 text-[9px] font-bold text-white">{unread}</span>}
        </button>

        <button
          type="button"
          onClick={() => setView("pending")}
          className="relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs hover:bg-muted"
          title="Pending changes"
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Pending</span>
          {pending > 0 && <span className="rounded-full bg-[#F76D01] px-1.5 text-[10px] font-bold text-white">{pending}</span>}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 hover:bg-muted" aria-label="Agent settings">
            <Settings className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-3">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-xs font-semibold">Apply agent changes without asking</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Off by default. When on, proposed changes apply immediately and still appear in Change history with undo.
                </p>
              </div>
              <Toggle checked={autoApprove} onChange={setAutoApprove} label="Auto-approve" />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

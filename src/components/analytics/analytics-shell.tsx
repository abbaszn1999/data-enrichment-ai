"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { AlertCircle, BarChart3, RefreshCw, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageLoader } from "@/components/brand/page-loader";
import { AnalyticsConnectionCards } from "@/components/analytics/connection-cards";
import { AnalyticsPropertyPicker } from "@/components/analytics/property-picker";
import { AnalyticsRulesDialog } from "@/components/analytics/rules-dialog";
import { useWorkspaceContext } from "@/app/(dashboard)/w/[workspaceSlug]/workspace-context";
import { useRole } from "@/hooks/use-role";
import {
  disconnectAnalytics,
  invalidateClientAnalyticsCache,
  saveAnalyticsRules,
  useAnalytics,
} from "@/hooks/use-analytics";
import { parseAnalyticsDateRange, peekAnalyticsDateRange, readStoredAnalyticsDateRange, storeAnalyticsDateRange } from "@/lib/analytics/dates";
import {
  isAnalyticsConnectionType,
  type AnalyticsConnectionType,
  type AnalyticsDateRange,
  type AnalyticsPageType,
} from "@/lib/analytics/types";

const ERROR_COPY: Record<string, string> = {
  not_configured: "Google OAuth is not configured on this server yet.",
  oauth_denied: "Google sign-in was cancelled.",
  unauthorized: "Sign in again, then connect Google.",
  forbidden: "Only owners and admins can connect Analytics.",
  callback_failed: "Google connection failed. Try again.",
  invalid_type: "Unknown Google connection type.",
};

const PAGE_COPY = {
  overview: {
    title: "Overview",
    blurb: "Site-wide search and on-site performance from Search Console and Analytics 4.",
  },
  plp: {
    title: "PLP Pages",
    blurb: "The same metrics, limited to collection and listing URLs after you set the rules.",
  },
  products: {
    title: "Products Pages",
    blurb: "The same metrics, limited to product URLs after you set the rules.",
  },
} as const;

const CONNECTION_LABEL: Record<AnalyticsConnectionType, string> = {
  "search-console": "Search Console",
  "google-analytics": "Analytics 4",
};

function statusKeyForType(type: AnalyticsConnectionType): "gsc" | "ga4" {
  return type === "search-console" ? "gsc" : "ga4";
}

export function AnalyticsShell({
  page,
  pageType,
  children,
}: {
  page: keyof typeof PAGE_COPY;
  pageType?: AnalyticsPageType;
  children: (ctx: {
    analytics: ReturnType<typeof useAnalytics>;
    gscReady: boolean;
    ga4Ready: boolean;
    range: AnalyticsDateRange;
    canManage: boolean;
    openRules: () => void;
  }) => ReactNode;
}) {
  const { workspace, role } = useWorkspaceContext();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const permissions = useRole(role);
  const [range, setRange] = useState<AnalyticsDateRange>(
    () => peekAnalyticsDateRange(workspace?.id) ?? "28"
  );
  const [busyType, setBusyType] = useState<AnalyticsConnectionType | null>(null);
  const [disconnectType, setDisconnectType] = useState<AnalyticsConnectionType | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pickerType, setPickerType] = useState<AnalyticsConnectionType | null>(null);
  const analytics = useAnalytics(workspace?.id ?? null, range, pageType);
  const copy = PAGE_COPY[page];
  const showDataControls = !pageType || !!analytics.rules;

  // Tracks which connection types we've already auto-opened the property
  // popup for in this mount, so a status re-fetch after the user manually
  // cancels the dialog doesn't keep forcing it back open.
  const autoOpenedRef = useRef<Record<AnalyticsConnectionType, boolean>>({
    "search-console": false,
    "google-analytics": false,
  });

  useEffect(() => {
    const connected = searchParams.get("connected");
    const pick = searchParams.get("pick");
    const error = searchParams.get("error");
    if (connected) toast.success("Google account connected");
    if (error) toast.error(ERROR_COPY[error] || "Could not complete Google connection");
    if (connected || error) {
      router.replace(pathname);
    }
    if (connected && workspace?.id) {
      // The OAuth callback just wrote a new connection. The status route's
      // 60s server cache was invalidated server-side, but this tab's own
      // client cache (and any `refresh(false)` that ran before the redirect
      // landed here) can still be holding the pre-connect snapshot — force
      // a real round trip instead of waiting for that cache to expire.
      invalidateClientAnalyticsCache(workspace.id);
      void analytics.refresh(true);
    }
    if (connected && isAnalyticsConnectionType(connected) && pick === "1") {
      // The callback found more than one property for this account — open
      // the popup immediately instead of waiting for the forced status
      // refresh above to resolve `needsProperty` a moment later.
      autoOpenedRef.current[connected] = true;
      setPickerType(connected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router, searchParams, workspace?.id]);

  useEffect(() => {
    if (!workspace?.id) return;
    setRange(readStoredAnalyticsDateRange(workspace.id));
  }, [workspace?.id]);

  // Fallback trigger: covers a connection that needs a property for any
  // other reason (page load with an already-connected-but-unset account,
  // the `pick` param missing, zero properties returned so nothing was
  // auto-selected, etc). Opens at most one popup per type per mount.
  useEffect(() => {
    if (pickerType || analytics.statusLoading) return;
    if (analytics.status.gsc.needsProperty && !autoOpenedRef.current["search-console"]) {
      autoOpenedRef.current["search-console"] = true;
      setPickerType("search-console");
      return;
    }
    if (analytics.status.ga4.needsProperty && !autoOpenedRef.current["google-analytics"]) {
      autoOpenedRef.current["google-analytics"] = true;
      setPickerType("google-analytics");
    }
  }, [analytics.status, analytics.statusLoading, pickerType]);

  if (!workspace) return <PageLoader />;

  const gscReady = analytics.status.gsc.connected && !analytics.status.gsc.needsProperty;
  const ga4Ready = analytics.status.ga4.connected && !analytics.status.ga4.needsProperty;

  return (
    <div className="autommerce-dashboard flex-1 overflow-auto bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-6 py-7">
          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                  <BarChart3 className="h-4 w-4" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                  Analytics
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
                {copy.title}
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                {copy.blurb} Workspace:{" "}
                <span className="font-medium text-foreground">{workspace.name}</span>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showDataControls ? (
                <>
                  <div className="inline-flex h-9 items-center rounded-xl border bg-background p-0.5">
                    {(["7", "28", "90"] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          const next = parseAnalyticsDateRange(id);
                          setRange(next);
                          if (workspace?.id) storeAnalyticsDateRange(workspace.id, next);
                        }}
                        className={`h-8 rounded-lg px-3 text-xs font-semibold ${
                          range === id
                            ? "bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/12 dark:text-[#F76D01]"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {id}d
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl text-xs"
                    onClick={() => analytics.refresh()}
                    disabled={analytics.statusLoading || analytics.gscLoading || analytics.ga4Loading}
                  >
                    <RefreshCw
                      className={`mr-1.5 h-3.5 w-3.5 ${
                        analytics.gscLoading || analytics.ga4Loading ? "animate-spin" : ""
                      }`}
                    />
                    Refresh
                  </Button>
                </>
              ) : null}
              {pageType && permissions.canAdmin ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl text-xs"
                  onClick={() => setRulesOpen(true)}
                >
                  <Settings className="mr-1.5 h-3.5 w-3.5" />
                  {analytics.rules ? "Edit rules" : "Set up rules"}
                </Button>
              ) : null}
            </div>
          </motion.header>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <AnalyticsConnectionCards
          status={analytics.status}
          loading={analytics.statusLoading}
          canManage={permissions.canAdmin}
          workspaceId={workspace.id}
          slug={slug}
          busyType={busyType}
          onDisconnect={(type) => setDisconnectType(type)}
          onChooseProperty={(type) => setPickerType(type)}
        />

        <AnalyticsPropertyPicker
          open={pickerType !== null}
          onOpenChange={(open) => {
            if (!open) setPickerType(null);
          }}
          workspaceId={workspace.id}
          type={pickerType ?? "search-console"}
          title={pickerType ? CONNECTION_LABEL[pickerType] : "property"}
          hasExistingProperty={
            pickerType ? !analytics.status[statusKeyForType(pickerType)].needsProperty : false
          }
          onSaved={() => {
            if (pickerType) void analytics.refreshSource(pickerType);
          }}
        />

        {analytics.error && (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{analytics.error}</p>
          </div>
        )}

        {children({
          analytics,
          gscReady,
          ga4Ready,
          range,
          canManage: permissions.canAdmin,
          openRules: () => setRulesOpen(true),
        })}
      </div>
      <AlertDialog
        open={!!disconnectType}
        onOpenChange={(open) => {
          if (!open && !busyType) setDisconnectType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {disconnectType ? CONNECTION_LABEL[disconnectType] : "Google"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This workspace will stop pulling data from this Google account until you connect
              again. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyType}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={!!busyType}
              onClick={async () => {
                if (!disconnectType) return;
                setBusyType(disconnectType);
                try {
                  await disconnectAnalytics(workspace.id, disconnectType);
                  // The row is already gone server-side — flip local state
                  // immediately instead of blocking on a full status +
                  // up-to-7-endpoint reload that would also needlessly
                  // re-pull the *other*, still-connected source.
                  analytics.applyDisconnect(disconnectType);
                  autoOpenedRef.current[disconnectType] = false;
                  if (pickerType === disconnectType) setPickerType(null);
                  toast.success("Disconnected");
                  setDisconnectType(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Disconnect failed");
                } finally {
                  setBusyType(null);
                }
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {pageType ? (
        <AnalyticsRulesDialog
          open={rulesOpen}
          onOpenChange={setRulesOpen}
          pageType={pageType}
          initialConfig={analytics.rules}
          onSave={async (config) => {
            await saveAnalyticsRules(workspace.id, pageType, config);
            toast.success("Rules saved");
            await analytics.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

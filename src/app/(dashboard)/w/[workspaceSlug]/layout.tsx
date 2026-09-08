"use client";

import { useState, useEffect, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Upload,
  CreditCard,
  Users,
  Settings,
  ChevronDown,
  ChevronRight,
  LogOut,
  User,
  PanelLeftClose,
  FileSpreadsheet,
  Sun,
  Moon,
  Building2,
  Plus,
  Check,
  Coins,
  Crown,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  Boxes,
  Rocket,
  Search,
  Paintbrush,
  RefreshCw,
  LayoutTemplate,
  Wallet,
  Bot,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import { useRole } from "@/hooks/use-role";
import { useCredits } from "@/hooks/use-credits";
import { useSubscription } from "@/hooks/use-subscription";
import { signOut } from "@/lib/auth";
import { formatCredits } from "@/lib/format-credits";
import { formatMoney } from "@/lib/wallet/format";
import { useWallet } from "@/hooks/use-wallet";
import type { Workspace } from "@/lib/supabase";
import type { Role } from "@/lib/permissions";
import { useWorkspaceStore } from "@/store/workspace-store";
import { useSyncStore } from "@/store/sync-store";
import { SubscriptionGate, SubscriptionBanner } from "@/components/subscription-gate";
import { AutommerceLogo } from "@/components/brand/autommerce-logo";
import { PageLoader } from "@/components/brand/page-loader";
import { WorkspaceContext } from "./workspace-context";
import { JobInbox } from "@/components/job-inbox";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const slug = params.workspaceSlug as string;

  const { user, profile, sessionReady } = useAuth();
  const { workspace, role, hasIntegration, isLoading: wsLoading, error } = useWorkspace(slug, user);
  const permissions = useRole(role);

  const credits = useCredits(workspace?.id ?? null);
  const { wallet } = useWallet(workspace?.id ?? null);
  const walletBalance = wallet?.balance ?? null;
  const { subscription, isActive, isLoading: subLoading } = useSubscription(workspace?.id ?? null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [growthEngineOpen, setGrowthEngineOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // `hasIntegration` (for Sync nav gating) now comes from the single
  // workspace-bootstrap request via useWorkspace — no separate fetch needed.

  // Sync focus mode — hides header + sidebar when chat is active
  const { isFocusMode: syncFocusMode } = useSyncStore();

  // Sync workspace into Zustand store so Sidebar and other components can access it
  const { setWorkspace: setStoreWorkspace, setRole: setStoreRole } = useWorkspaceStore();
  useEffect(() => {
    setStoreWorkspace(workspace);
    setStoreRole(role);
  }, [workspace, role, setStoreWorkspace, setStoreRole]);

  const basePath = `/w/${slug}`;

  // Hide workspace nav sidebar on enrichment workbench tool (it has its own left panel).
  // Keep the top app header visible so credits / workspace / user stay accessible.
  // Exclude /new so the intake form can scroll normally with the sidebar intact.
  const isEnrichPage =
    /^\/w\/[^/]+\/catalog-intelligence\/[^/]+$/.test(pathname) &&
    !pathname.endsWith("/new");
  const isSyncPage =
    pathname === `${basePath}/store-assistant` || pathname.startsWith(`${basePath}/store-assistant/`);
  const isMarketResearchPage = pathname.includes("/market-research");
  const isWebsiteRestructurePage = pathname.includes("/website-restructure");
  const isProductsGalleryPage = pathname.includes("/products-gallery");
  const isProductsGalleryProject = isProductsGalleryPage && searchParams.has("project");
  const isProductsVisualizerPage = pathname.includes("/products-visualizer");
  const isProductsVisualizerProject =
    isProductsVisualizerPage && searchParams.has("project");
  const hideWorkspaceSidebar =
    isEnrichPage ||
    isProductsGalleryProject ||
    isProductsVisualizerProject ||
    isMarketResearchPage ||
    isWebsiteRestructurePage ||
    (isSyncPage && syncFocusMode);
  // Immersive mode hides the top header — keep false so Enrich shows it
  const isImmersive = false;
  // Lock main content height so tool UIs (Enrich sidebar/table) scroll internally.
  // Growth Sync is a regular scrollable dashboard page, so it's excluded here.
  const lockContentHeight =
    isEnrichPage || isSyncPage || isMarketResearchPage || isWebsiteRestructurePage;
  // Subscription page should be accessible without an active subscription
  const isSubscriptionPage =
    pathname === `${basePath}/subscription` ||
    pathname.startsWith(`${basePath}/subscription/`);
  const isTeamPage = pathname.includes("/team");
  const isSettingsPage = pathname.includes("/settings");
  const requiresAdminAccess = isTeamPage || isSettingsPage;
  const canAccessAdminPages = role === "owner" || role === "admin";

  const mediaChildren = [
    { href: `${basePath}/image-classify`, label: "Image Classification", icon: ImageIcon },
    { href: `${basePath}/products-gallery`, label: "Products Gallery", icon: LayoutGrid },
    { href: `${basePath}/products-visualizer`, label: "Products Visualizer", icon: Boxes },
  ];

  // Parent group only — Store assistant and Website restructure are
  // top-level items, not nested here.
  const growthEngineChildren = [
    {
      href: hasIntegration ? `${basePath}/market-research` : "",
      label: "Market research",
      icon: Search,
      disabled: !hasIntegration,
    },
    {
      href: hasIntegration ? `${basePath}/customize` : "",
      label: "Customize",
      icon: Paintbrush,
      disabled: !hasIntegration,
    },
    {
      href: hasIntegration ? `${basePath}/growth-sync` : "",
      label: "Growth Sync",
      icon: RefreshCw,
      disabled: !hasIntegration,
    },
    { href: `${basePath}/wallet`, label: "Wallet", icon: Wallet },
  ];

  const isMediaActive = mediaChildren.some(
    (child) => pathname === child.href || pathname.startsWith(child.href + "/")
  );

  const isGrowthEngineActive = growthEngineChildren.some(
    (child) =>
      !!child.href &&
      (pathname === child.href || pathname.startsWith(child.href + "/"))
  );

  useEffect(() => {
    if (isMediaActive) setMediaOpen(true);
  }, [isMediaActive]);

  useEffect(() => {
    if (isGrowthEngineActive) setGrowthEngineOpen(true);
  }, [isGrowthEngineActive]);

  const sidebarLinksBeforeMedia = [
    { href: `${basePath}`, label: "Dashboard", icon: LayoutDashboard },
    { href: `${basePath}/products`, label: "Products", icon: Package },
    { href: `${basePath}/categories`, label: "Categories", icon: FolderTree },
    { href: `${basePath}/catalog-intelligence`, label: "Catalog Intelligence", icon: Upload },
  ];

  const toolsLinksAfterGrowthEngine = [
    {
      href: hasIntegration ? `${basePath}/website-restructure` : "",
      label: "Website restructure",
      icon: LayoutTemplate,
      disabled: !hasIntegration,
    },
    {
      href: hasIntegration ? `${basePath}/store-assistant` : "",
      label: "Store assistant",
      icon: Bot,
      disabled: !hasIntegration,
    },
    { href: `${basePath}/usage`, label: "Usage", icon: CreditCard },
  ];

  const accountLinks = [
    ...(permissions.canAdmin
      ? [{ href: `${basePath}/team`, label: "Team", icon: Users }]
      : []),
    ...(permissions.canAdmin
      ? [{ href: `${basePath}/settings`, label: "Settings", icon: Settings }]
      : []),
    ...(permissions.isOwner
      ? [{ href: `${basePath}/subscription`, label: "Subscription", icon: Crown }]
      : []),
  ];

  const isLinkActive = (href: string) =>
    pathname === href ||
    (href !== basePath && pathname.startsWith(href + "/")) ||
    (href === basePath && pathname === basePath);

  // Section label — small uppercase caption above a group of nav links.
  // Fades out (rather than disappearing instantly) when the sidebar collapses.
  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <AnimatePresence initial={false}>
      {!sidebarCollapsed && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15 }}
          className="px-2.5 pt-3.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 overflow-hidden"
        >
          {children}
        </motion.p>
      )}
    </AnimatePresence>
  );

  const renderNavLink = (link: {
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    disabled?: boolean;
  }, opts?: { nested?: boolean }) => {
    if (link.disabled) {
      return (
        <div
          key={link.label}
          className={`relative flex items-center gap-2.5 rounded-lg text-xs font-medium cursor-not-allowed text-muted-foreground/35 select-none ${
            opts?.nested ? "px-2.5 py-1.5 pl-8" : "px-2.5 py-2"
          }`}
          title={sidebarCollapsed ? link.label : undefined}
        >
          <link.icon className="h-4 w-4 shrink-0" />
          {!sidebarCollapsed && <span>{link.label}</span>}
        </div>
      );
    }
    const isActive = isLinkActive(link.href);
    return (
      <Link
        key={link.href}
        href={link.href}
        title={sidebarCollapsed ? link.label : undefined}
        className={`group relative flex items-center gap-2.5 rounded-lg text-xs font-medium transition-colors duration-150 ${
          opts?.nested ? "py-1.5 pl-8 pr-2.5" : "px-2.5 py-2"
        } ${
          isActive
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {isActive && (
          <motion.span
            layoutId="sidebar-active-pill"
            className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-primary/15"
            transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.9 }}
          />
        )}
        {!isActive && (
          <span className="absolute inset-0 rounded-lg bg-muted/0 group-hover:bg-muted transition-colors duration-150" />
        )}
        <motion.span
          className="relative z-10 shrink-0 flex items-center justify-center"
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <link.icon className="h-4 w-4" />
        </motion.span>
        {!sidebarCollapsed && <span className="relative z-10">{link.label}</span>}
        {isActive && sidebarCollapsed && (
          <motion.span
            layoutId="sidebar-active-dot"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-primary"
          />
        )}
      </Link>
    );
  };

  // Collapsible group header (Visual Intelligence / Growth engine) — animates
  // its chevron rotation and the height of its child list smoothly.
  const renderNavGroup = (opts: {
    label: string;
    icon: ComponentType<{ className?: string }>;
    isOpen: boolean;
    setOpen: (v: boolean) => void;
    isActive: boolean;
    children: { href: string; label: string; icon: ComponentType<{ className?: string }>; disabled?: boolean }[];
  }) => {
    const { label, icon: Icon, isOpen, setOpen, isActive, children } = opts;
    if (sidebarCollapsed) {
      return (
        <button
          onClick={() => {
            setSidebarCollapsed(false);
            setOpen(true);
          }}
          className={`relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium w-full transition-colors duration-150 ${
            isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
          title={label}
        >
          {isActive && (
            <motion.span
              layoutId="sidebar-active-pill"
              className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-primary/15"
              transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.9 }}
            />
          )}
          {!isActive && (
            <span className="absolute inset-0 rounded-lg bg-muted/0 hover:bg-muted transition-colors duration-150" />
          )}
          <Icon className="relative z-10 h-4 w-4 shrink-0" />
        </button>
      );
    }
    return (
      <div>
        <button
          onClick={() => setOpen(!isOpen)}
          className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium w-full transition-colors duration-150 ${
            isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="absolute inset-0 rounded-lg bg-muted/0 group-hover:bg-muted transition-colors duration-150" />
          <Icon className="relative z-10 h-4 w-4 shrink-0" />
          <span className="relative z-10 flex-1 text-left">{label}</span>
          <motion.span
            className="relative z-10 shrink-0 flex items-center justify-center"
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 26 }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <div className="relative mt-0.5 space-y-0.5">
                <div className="absolute left-[19px] top-0.5 bottom-0.5 w-px bg-border/60" />
                {children.map((child) => renderNavLink(child, { nested: true }))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  // Auto-redirect if user is not a member (e.g. removed from workspace)
  useEffect(() => {
    if (!wsLoading && error && sessionReady && user) {
      router.replace("/workspaces");
    }
  }, [wsLoading, error, sessionReady, user, router]);

  useEffect(() => {
    if (!wsLoading && workspace && isSubscriptionPage && role !== "owner") {
      router.replace(basePath);
    }
  }, [wsLoading, workspace, isSubscriptionPage, role, router, basePath]);

  useEffect(() => {
    if (!wsLoading && workspace && requiresAdminAccess && !canAccessAdminPages) {
      router.replace(basePath);
    }
  }, [wsLoading, workspace, requiresAdminAccess, canAccessAdminPages, router, basePath]);

  if (!wsLoading && (error || !workspace)) {
    return <PageLoader label="Redirecting…" className="min-h-screen" />;
  }

  if (!wsLoading && workspace && isSubscriptionPage && role !== "owner") {
    return <PageLoader label="Redirecting…" className="min-h-screen" />;
  }

  if (!wsLoading && workspace && requiresAdminAccess && !canAccessAdminPages) {
    return <PageLoader label="Redirecting…" className="min-h-screen" />;
  }

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  const initials = profile?.full_name
    ? profile.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "??";

  return (
    <WorkspaceContext.Provider value={{ workspace, role, wsLoading, hasIntegration: !!hasIntegration }}>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {/* Top Header — hidden in immersive mode */}
        <header className={`border-b bg-background/95 backdrop-blur-sm sticky top-0 z-50 shrink-0 transition-all duration-300 ${
          isImmersive ? "h-0 border-transparent overflow-hidden" : "h-12 overflow-visible"
        }`}>
          <div className="flex items-center justify-between h-12 px-4">
            {/* Left: Logo + Workspace Name */}
            <div className="flex items-center gap-3">
              <Link href={basePath} className="group flex items-center gap-2.5">
                <AutommerceLogo size={28} priority className="transition-transform duration-300 group-hover:scale-105" />
                <span className="leading-none">
                  <span className="block text-sm font-black tracking-tight text-foreground [font-family:var(--brand-font)]">
                    Autommerce
                  </span>
                  <span className="mt-0.5 block text-[8px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    AI Commerce Operations
                  </span>
                </span>
              </Link>

              <span className="text-muted-foreground/30">|</span>

              <Link
                href={basePath}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted text-sm transition-colors"
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium text-xs">{workspace?.name ?? "..."}</span>
              </Link>
            </div>

            {/* Right: Wallet + Credits + Theme + User */}
            <div className="flex items-center gap-2">
              {walletBalance !== null && (
                <Link
                  href={`${basePath}/wallet`}
                  title="Wallet balance"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium tabular-nums transition-colors ${
                    walletBalance < 25
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                >
                  <Wallet className="h-3.5 w-3.5" />
                  <span>{formatMoney(walletBalance)}</span>
                </Link>
              )}

              {/* Credits Badge */}
              {!credits.isLoading && credits.total > 0 && (
                <Link
                  href={`${basePath}/usage`}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    credits.isLow
                      ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                >
                  <Coins className="h-3.5 w-3.5" />
                  <span title={`Monthly ${formatCredits(credits.total)} · bonus included in available`}>
                    {formatCredits(credits.remaining)} available
                  </span>
                </Link>
              )}

              {workspace?.id && <JobInbox workspaceId={workspace.id} />}

              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                suppressHydrationWarning
              >
                {mounted && (theme === "dark" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                ))}
              </button>

              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-primary">
                      {initials}
                    </span>
                  </div>
                  <span className="text-xs font-medium hidden sm:block">
                    {profile?.full_name || user?.email}
                  </span>
                  {role && (
                    <span className={`hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide border ${
                      role === "owner" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" :
                      role === "admin" ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30" :
                      role === "editor" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" :
                      "bg-muted text-muted-foreground border-border/50"
                    }`}>
                      {role}
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
                {userMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setUserMenuOpen(false)}
                    />
                    <div className="absolute top-full right-0 mt-1 w-52 bg-popover border rounded-lg shadow-lg z-50 py-1">
                      <div className="px-3 py-2.5 border-b space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold truncate">
                            {profile?.full_name || "User"}
                          </div>
                          {role && (
                            <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide border ${
                              role === "owner" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" :
                              role === "admin" ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30" :
                              role === "editor" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" :
                              "bg-muted text-muted-foreground border-border/50"
                            }`}>
                              {role}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {user?.email}
                        </div>
                      </div>
                      <Link
                        href="/workspaces"
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                        onClick={() => setUserMenuOpen(false)}
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        <span className="text-xs">Switch Workspace</span>
                      </Link>
                      <div className="border-t my-1" />
                      <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-destructive"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        <span className="text-xs">Sign Out</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Body: Sidebar + Content */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar — hidden in enrich and Sync focused mode */}
          {!hideWorkspaceSidebar && (
          <motion.aside
            animate={{ width: sidebarCollapsed ? 60 : 216 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="relative border-r border-border/70 bg-sidebar text-sidebar-foreground shrink-0 flex flex-col shadow-[1px_0_0_0_rgba(0,0,0,0.02)]"
          >
            <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto overflow-x-hidden custom-scrollbar">
              <SectionLabel>Overview</SectionLabel>
              {sidebarLinksBeforeMedia.map((link) => renderNavLink(link))}

              <SectionLabel>Visual Intelligence</SectionLabel>
              {renderNavGroup({
                label: "Visual Intelligence",
                icon: Images,
                isOpen: mediaOpen,
                setOpen: setMediaOpen,
                isActive: isMediaActive,
                children: mediaChildren,
              })}

              <SectionLabel>Growth engine</SectionLabel>
              {renderNavGroup({
                label: "Growth engine",
                icon: Rocket,
                isOpen: growthEngineOpen,
                setOpen: setGrowthEngineOpen,
                isActive: isGrowthEngineActive,
                children: growthEngineChildren,
              })}

              <SectionLabel>Tools</SectionLabel>
              {toolsLinksAfterGrowthEngine.map((link) => renderNavLink(link))}

              {accountLinks.length > 0 && (
                <>
                  <SectionLabel>Account</SectionLabel>
                  {accountLinks.map((link) => renderNavLink(link))}
                </>
              )}
            </nav>

            <div className="p-2 border-t border-border/70">
              <motion.button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground w-full transition-colors"
              >
                <motion.span
                  animate={{ rotate: sidebarCollapsed ? 180 : 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="flex items-center justify-center shrink-0"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </motion.span>
                <AnimatePresence initial={false}>
                  {!sidebarCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden whitespace-nowrap"
                    >
                      Collapse
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </motion.aside>
          )}

          {/* Main Content */}
          <main className={`flex-1 flex flex-col min-h-0 ${lockContentHeight ? "overflow-hidden" : "overflow-auto"}`}>
            {!isImmersive && (
              <SubscriptionBanner
                subscription={subscription}
                isLoading={subLoading}
                role={role}
              />
            )}
            {isSubscriptionPage || isSyncPage ? (
              <div className={isSyncPage ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "flex min-h-0 flex-1 flex-col"}>
                {children}
              </div>
            ) : (
              <SubscriptionGate subscription={subscription} isActive={isActive} isLoading={subLoading} role={role}>
                <div
                  className={
                    isEnrichPage || isMarketResearchPage || isWebsiteRestructurePage
                      ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden"
                      : "flex min-h-0 flex-1 flex-col"
                  }
                >
                  {children}
                </div>
              </SubscriptionGate>
            )}
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}

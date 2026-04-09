"use client";

import { useState, useEffect, createContext, useContext } from "react";
import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Upload,
  CreditCard,
  Users,
  Settings,
  ChevronDown,
  LogOut,
  User,
  PanelLeftClose,
  PanelLeft,
  FileSpreadsheet,
  Sun,
  Moon,
  Building2,
  Plus,
  Check,
  Loader2,
  Coins,
  Crown,
  RefreshCw,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace";
import { useRole } from "@/hooks/use-role";
import { useCredits } from "@/hooks/use-credits";
import { signOut } from "@/lib/auth";
import { formatCredits } from "@/lib/format-credits";
import type { Workspace } from "@/lib/supabase";
import type { Role } from "@/lib/permissions";
import { useWorkspaceStore } from "@/store/workspace-store";
import { SubscriptionGate, SubscriptionBanner } from "@/components/subscription-gate";

interface WorkspaceContextType {
  workspace: Workspace | null;
  role: Role | null;
  wsLoading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspace: null,
  role: null,
  wsLoading: true,
});

export const useWorkspaceContext = () => useContext(WorkspaceContext);

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const slug = params.workspaceSlug as string;

  const { user, profile, sessionReady } = useAuth();
  const { workspace, role, isLoading: wsLoading, error } = useWorkspace(slug, user);
  const permissions = useRole(role);

  const credits = useCredits(workspace?.id ?? null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Sync workspace into Zustand store so Sidebar and other components can access it
  const { setWorkspace: setStoreWorkspace, setRole: setStoreRole } = useWorkspaceStore();
  useEffect(() => {
    setStoreWorkspace(workspace);
    setStoreRole(role);
  }, [workspace, role, setStoreWorkspace, setStoreRole]);

  const basePath = `/w/${slug}`;

  // Hide main sidebar + header on enrichment tool page (it has its own UI)
  const isEnrichPage = pathname.includes("/enrich");
  // Subscription page should be accessible without an active subscription
  const isSubscriptionPage = pathname.includes("/subscription");
  const isTeamPage = pathname.includes("/team");
  const isSettingsPage = pathname.includes("/settings");
  const requiresAdminAccess = isTeamPage || isSettingsPage;
  const canAccessAdminPages = role === "owner" || role === "admin";

  const sidebarLinks = [
    { href: `${basePath}`, label: "Dashboard", icon: LayoutDashboard },
    { href: `${basePath}/products`, label: "Products", icon: Package },
    { href: `${basePath}/categories`, label: "Categories", icon: FolderTree },
    { href: `${basePath}/import`, label: "Import", icon: Upload },
    { href: "", label: "Sync", icon: RefreshCw, comingSoon: true },
    { href: `${basePath}/usage`, label: "Usage", icon: CreditCard },
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
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  if (!wsLoading && workspace && isSubscriptionPage && role !== "owner") {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    );
  }

  if (!wsLoading && workspace && requiresAdminAccess && !canAccessAdminPages) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    );
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
    <WorkspaceContext.Provider value={{ workspace, role, wsLoading }}>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {/* Top Header */}
        <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-30 shrink-0">
          <div className="flex items-center justify-between h-12 px-4">
            {/* Left: Logo + Workspace Name */}
            <div className="flex items-center gap-3">
              <Link href="/workspaces" className="flex items-center gap-2">
                <div className="p-1 rounded-md bg-primary">
                  <FileSpreadsheet className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="font-bold text-sm tracking-tight">DataSheet AI</span>
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

            {/* Right: Credits + Theme + User */}
            <div className="flex items-center gap-2">
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
                  <span>{formatCredits(credits.remaining)}</span>
                  <span className="text-muted-foreground/60">/ {formatCredits(credits.total)}</span>
                </Link>
              )}

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
          {/* Sidebar — hidden on enrichment tool page */}
          {!isEnrichPage && (
          <aside
            className={`border-r bg-muted/30 shrink-0 flex flex-col transition-all duration-200 ${
              sidebarCollapsed ? "w-14" : "w-52"
            }`}
          >
            <nav className="flex-1 py-2 px-2 space-y-0.5">
              {sidebarLinks.map((link) => {
                if ((link as any).comingSoon) {
                  return (
                    <div
                      key={link.label}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium cursor-not-allowed text-muted-foreground/40 select-none"
                      title={sidebarCollapsed ? link.label : undefined}
                    >
                      <link.icon className="h-4 w-4 shrink-0" />
                      {!sidebarCollapsed && (
                        <>
                          <span className="flex-1">{link.label}</span>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground/60 leading-none">
                            Soon
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                const isActive =
                  pathname === link.href ||
                  (link.href !== basePath && pathname.startsWith(link.href + "/")) ||
                  (link.href === basePath && pathname === basePath);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    title={sidebarCollapsed ? link.label : undefined}
                  >
                    <link.icon className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed && <span>{link.label}</span>}
                  </Link>
                );
              })}
            </nav>

            <div className="p-2 border-t">
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted hover:text-foreground w-full transition-colors"
              >
                {sidebarCollapsed ? (
                  <PanelLeft className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
                {!sidebarCollapsed && <span>Collapse</span>}
              </button>
            </div>
          </aside>
          )}

          {/* Main Content */}
          <main className={`flex-1 flex flex-col min-h-0 ${isEnrichPage ? "overflow-hidden" : "overflow-auto"}`}>
            {!isEnrichPage && <SubscriptionBanner workspaceId={workspace?.id ?? null} />}
            {isSubscriptionPage || isEnrichPage ? (
              <div className={isEnrichPage ? "flex-1 flex flex-col min-h-0 overflow-hidden" : "flex-1"}>{children}</div>
            ) : (
              <SubscriptionGate workspaceId={workspace?.id ?? null} role={role}>
                <div className="flex-1">{children}</div>
              </SubscriptionGate>
            )}
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}

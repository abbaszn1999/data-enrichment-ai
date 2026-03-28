"use client";

import { useState, createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { useTheme } from "next-themes";
import { mockUser, mockWorkspaces } from "./mock-data";

// Demo auth context
const DemoContext = createContext({
  currentWorkspace: mockWorkspaces[0],
  user: mockUser,
});
export const useDemoContext = () => useContext(DemoContext);

const sidebarLinks = [
  { href: "/demo/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/demo/products", label: "Products", icon: Package },
  { href: "/demo/categories", label: "Categories", icon: FolderTree },
  { href: "/demo/import", label: "Import", icon: Upload },
  { href: "/demo/usage", label: "Usage", icon: CreditCard },
  { href: "/demo/team", label: "Team", icon: Users },
  { href: "/demo/settings", label: "Settings", icon: Settings },
];

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Auth pages don't get the dashboard layout
  if (pathname === "/demo" || pathname === "/demo/login" || pathname === "/demo/register") {
    return <>{children}</>;
  }

  return (
    <DemoContext.Provider value={{ currentWorkspace: mockWorkspaces[0], user: mockUser }}>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {/* Top Header */}
        <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-30 shrink-0">
          <div className="flex items-center justify-between h-12 px-4">
            {/* Left: Logo + Workspace Switcher */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-md bg-primary">
                  <FileSpreadsheet className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="font-bold text-sm tracking-tight">DataSheet AI</span>
              </div>

              <span className="text-muted-foreground/30">|</span>

              {/* Workspace Switcher */}
              <div className="relative">
                <button
                  onClick={() => { setWsDropdownOpen(!wsDropdownOpen); setUserMenuOpen(false); }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted text-sm transition-colors"
                >
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium text-xs">{mockWorkspaces[0].name}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
                {wsDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setWsDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 w-64 bg-popover border rounded-lg shadow-lg z-50 py-1">
                      {mockWorkspaces.map((ws) => (
                        <button
                          key={ws.id}
                          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted text-sm"
                          onClick={() => setWsDropdownOpen(false)}
                        >
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-xs truncate">{ws.name}</div>
                            <div className="text-[10px] text-muted-foreground">{ws.productCount} products</div>
                          </div>
                          {ws.id === mockWorkspaces[0].id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </button>
                      ))}
                      <div className="border-t my-1" />
                      <Link href="/demo/workspaces" className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted text-sm text-primary" onClick={() => setWsDropdownOpen(false)}>
                        <Plus className="h-4 w-4" />
                        <span className="text-xs font-medium">Create New Workspace</span>
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right: Theme + User */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
              >
                {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>

              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => { setUserMenuOpen(!userMenuOpen); setWsDropdownOpen(false); }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-primary">AR</span>
                  </div>
                  <span className="text-xs font-medium hidden sm:block">{mockUser.fullName}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute top-full right-0 mt-1 w-48 bg-popover border rounded-lg shadow-lg z-50 py-1">
                      <div className="px-3 py-2 border-b">
                        <div className="text-xs font-medium">{mockUser.fullName}</div>
                        <div className="text-[10px] text-muted-foreground">{mockUser.email}</div>
                      </div>
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted" onClick={() => setUserMenuOpen(false)}>
                        <User className="h-3.5 w-3.5" /> <span className="text-xs">Profile</span>
                      </button>
                      <button className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted" onClick={() => setUserMenuOpen(false)}>
                        <Settings className="h-3.5 w-3.5" /> <span className="text-xs">Settings</span>
                      </button>
                      <div className="border-t my-1" />
                      <Link href="/demo/login" className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-destructive" onClick={() => setUserMenuOpen(false)}>
                        <LogOut className="h-3.5 w-3.5" /> <span className="text-xs">Sign Out</span>
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Body: Sidebar + Content */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <aside className={`border-r bg-muted/30 shrink-0 flex flex-col transition-all duration-200 ${sidebarCollapsed ? "w-14" : "w-52"}`}>
            <nav className="flex-1 py-2 px-2 space-y-0.5">
              {sidebarLinks.map((link) => {
                const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
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
                {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                {!sidebarCollapsed && <span>Collapse</span>}
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </DemoContext.Provider>
  );
}

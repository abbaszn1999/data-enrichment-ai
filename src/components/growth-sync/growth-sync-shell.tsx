"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CreditCard, Crown, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "dashboard", label: "Dashboard", suffix: "", icon: LayoutDashboard },
  { id: "usage", label: "Usage", suffix: "/usage", icon: CreditCard },
  { id: "subscription", label: "Subscription", suffix: "/subscription", icon: Crown },
] as const;

export function GrowthSyncShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspaceSlug: string }>();
  const pathname = usePathname();
  const slug = params.workspaceSlug ?? "";
  const base = `/w/${slug}/growth-sync`;

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto">{children}</div>
      <aside className="w-48 shrink-0 border-l border-border/70 bg-muted/20">
        <nav className="sticky top-4 space-y-0.5 p-2">
          {TABS.map((tab) => {
            const href = `${base}${tab.suffix}`;
            const isActive =
              tab.id === "dashboard"
                ? pathname === base
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={tab.id}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <tab.icon className="h-4 w-4 shrink-0" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}

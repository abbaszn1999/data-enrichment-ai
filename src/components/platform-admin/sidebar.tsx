"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import { ADMIN_NAV } from "@/lib/platform-admin/nav";
import { adminRoutes } from "@/lib/platform-admin/paths";
import { cn } from "@/lib/utils";

export function AdminSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const groups = ["Command", "Customers", "Money", "Ops"] as const;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r bg-muted/30 transition-[width] duration-200",
        collapsed ? "w-14" : "w-52"
      )}
    >
      <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-3">
        {groups.map((group) => {
          const items = ADMIN_NAV.filter((item) => item.group === group);
          return (
            <div key={group}>
              {!collapsed ? (
                <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                  {group}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {items.map((item) => {
                  const overview = item.href === adminRoutes.overview();
                  const active = overview
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t p-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </aside>
  );
}

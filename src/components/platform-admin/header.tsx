"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { AutommerceLogo } from "@/components/brand/autommerce-logo";
import { Button } from "@/components/ui/button";
import { ADMIN_STAFF } from "@/lib/platform-admin/config";
import { adminRoutes } from "@/lib/platform-admin/paths";
import { logoutAdmin } from "@/lib/platform-admin/session";
import { GlobalSearch } from "./global-search";

export function AdminHeader() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const signOut = async () => {
    await logoutAdmin();
    router.replace(adminRoutes.login());
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        <AutommerceLogo size={22} priority />
        <span className="hidden truncate text-sm font-semibold tracking-tight sm:inline">
          Autommerce
        </span>
        <span className="rounded-md border border-[#6B358D]/20 bg-[#400095]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#400095] dark:border-[#F76D01]/30 dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
          Platform
        </span>
      </div>

      <GlobalSearch />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
          aria-label="Toggle theme"
        >
          {mounted && theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
        <div className="hidden text-right sm:block">
          <p className="text-[11px] font-medium leading-none">{ADMIN_STAFF.name}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{ADMIN_STAFF.email}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={signOut}>
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </header>
  );
}

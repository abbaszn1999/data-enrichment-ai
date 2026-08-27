"use client";

import { useState } from "react";
import { AdminAuthGate } from "./auth-gate";
import { AdminHeader } from "./header";
import { AdminSidebar } from "./sidebar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AdminAuthGate>
      <div className="autommerce-dashboard flex h-screen flex-col overflow-hidden bg-background [font-family:var(--brand-font)]">
        <AdminHeader />
        <div className="flex min-h-0 flex-1">
          <AdminSidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
          <main className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[88rem] space-y-5 p-5">{children}</div>
          </main>
        </div>
      </div>
    </AdminAuthGate>
  );
}

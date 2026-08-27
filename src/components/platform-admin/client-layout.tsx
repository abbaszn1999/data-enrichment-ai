"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminShell } from "@/components/platform-admin/shell";
import { isAdminLoginPath } from "@/lib/platform-admin/paths";

export function AdminClientLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isAdminLoginPath(pathname)) return <>{children}</>;
  return <AdminShell>{children}</AdminShell>;
}

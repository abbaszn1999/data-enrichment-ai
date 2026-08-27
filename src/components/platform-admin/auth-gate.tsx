"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/brand/page-loader";
import { ADMIN_LOGIN_PATH } from "@/lib/platform-admin/paths";
import { fetchAdminSession } from "@/lib/platform-admin/session";

export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAdminSession().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        router.replace(ADMIN_LOGIN_PATH);
        return;
      }
      setAllowed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!allowed) {
    return <PageLoader label="Checking access" />;
  }

  return <>{children}</>;
}

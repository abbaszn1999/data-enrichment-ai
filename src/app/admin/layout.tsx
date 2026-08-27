import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminClientLayout } from "@/components/platform-admin/client-layout";

export const metadata: Metadata = {
  title: "Autommerce Platform",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminClientLayout>{children}</AdminClientLayout>;
}

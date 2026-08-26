"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/brand/page-loader";

export default function DemoPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/demo/login");
  }, [router]);

  return <PageLoader className="min-h-screen" />;
}

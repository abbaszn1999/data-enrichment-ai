import type { Metadata } from "next";
import { ShareTokenClient } from "./share-token-client";

export const metadata: Metadata = {
  title: "Shared sheet — Autommerce",
  robots: { index: false, follow: false },
};

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ShareTokenClient token={token} />;
}

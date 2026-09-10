import { redirect } from "next/navigation";

export default async function AnalyticsIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") qs.set(key, value);
  }
  const suffix = qs.size ? `?${qs.toString()}` : "";
  redirect(`/w/${workspaceSlug}/analytics/overview${suffix}`);
}

import { redirect } from "next/navigation";

/** Legacy alias. Start for Free lives at /signup. */
export default async function RegisterAliasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value) qs.set(key, value);
  }
  const suffix = qs.toString();
  redirect(suffix ? `/signup?${suffix}` : "/signup");
}

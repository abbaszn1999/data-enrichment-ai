export async function fetchAdminSession(): Promise<boolean> {
  const res = await fetch("/api/platform-admin/session", { cache: "no-store" });
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  return Boolean(data?.ok);
}

export async function loginAdmin(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/platform-admin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "Sign in failed" };
  return { ok: true };
}

export async function logoutAdmin(): Promise<void> {
  await fetch("/api/platform-admin/session", { method: "DELETE" });
}

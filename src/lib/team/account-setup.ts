import type { SupabaseClient } from "@supabase/supabase-js";

export type AccountSetupSignals = {
  membershipCount: number;
  ownedWorkspaceCount: number;
  hasPassword: boolean;
  oauthProviders: string[];
};

/** Invite `/setup` is only for auth users who have never completed an account. */
export function needsAccountSetupFromSignals(signals: AccountSetupSignals): boolean {
  if (signals.membershipCount > 0) return false;
  if (signals.ownedWorkspaceCount > 0) return false;
  if (signals.hasPassword) return false;
  if (signals.oauthProviders.some((provider) => provider && provider !== "email")) {
    return false;
  }
  return true;
}

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() ?? "";
  if (!local) return "";
  return local
    .replace(/[._+\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Right after a magic-link verification, the browser session may not have
 * synced to the server's httpOnly cookies yet, so this API 401s briefly.
 * Retry once before giving up, and — since this gates whether we skip
 * password creation entirely — fail safe by assuming setup IS needed rather
 * than silently joining the workspace with no password.
 */
export async function fetchNeedsAccountSetup(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch("/api/team/account-setup-needed", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        console.log("[account-setup] account-setup-needed →", json);
        return !!json?.needsAccountSetup;
      }
      console.warn("[account-setup] account-setup-needed responded", res.status, "attempt", attempt);
      if (res.status === 401 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      break;
    } catch (err) {
      console.error("[account-setup] account-setup-needed fetch failed:", err);
      break;
    }
  }
  console.warn("[account-setup] falling back to needsAccountSetup=true (fail-safe)");
  return true;
}

export function inviteTokenFromPath(path: string): string | null {
  const match = path.match(/^\/invite\/([a-zA-Z0-9]+)(?:\/setup)?\/?$/);
  return match?.[1] ?? null;
}

export function inviteRedirectAfterAuth(
  next: string,
  needsAccountSetup: boolean,
  pendingInviteToken: string | null
): string | null {
  const token = inviteTokenFromPath(next);
  if (token) {
    return needsAccountSetup ? `/invite/${token}/setup` : `/invite/${token}`;
  }
  if (needsAccountSetup && pendingInviteToken) {
    return `/invite/${pendingInviteToken}/setup`;
  }
  return null;
}

export async function findAuthUserIdByEmail(
  admin: SupabaseClient,
  email: string
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const { data, error } = await admin.rpc("auth_user_id_by_email", {
    p_email: normalized,
  });
  if (!error) {
    return data ? String(data) : null;
  }

  for (let page = 1; page <= 20; page += 1) {
    const { data: listData } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const match = listData?.users?.find((user) => user.email?.toLowerCase() === normalized);
    if (match?.id) return match.id;
    if (!listData?.users?.length || listData.users.length < 200) break;
  }
  return null;
}

export async function userNeedsAccountSetup(
  admin: SupabaseClient,
  userId: string
): Promise<boolean> {
  const [members, owned, authUser] = await Promise.all([
    admin
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    admin
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId),
    admin.auth.admin.getUserById(userId),
  ]);

  const user = authUser.data.user;
  const providersFromMeta = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers
    : [];
  const providersFromIdentities = (user?.identities ?? []).map((identity) => identity.provider);

  // NOTE: auth.users.encrypted_password is NOT a reliable "has a real
  // password" signal — GoTrue writes a random bcrypt hash into that column
  // even for users created purely via signInWithOtp({ shouldCreateUser: true
  // }), who never touched a password field. Confirmed in production: a
  // brand-new invitee's encrypted_password was a real 60-char bcrypt hash
  // despite never setting one, which made the old RPC-based check silently
  // skip password creation for every new invite. We track "the user actually
  // went through our own set-password flow" explicitly via user_metadata
  // instead (set in signUp(), updatePassword(), and the invite /setup page).
  const hasPassword = user?.user_metadata?.password_set === true;

  const signals: AccountSetupSignals = {
    membershipCount: members.count ?? 0,
    ownedWorkspaceCount: owned.count ?? 0,
    hasPassword,
    oauthProviders: [...providersFromMeta, ...providersFromIdentities].map(String),
  };
  const result = needsAccountSetupFromSignals(signals);
  console.log("[account-setup] userNeedsAccountSetup", { userId, email: user?.email, ...signals, result });
  return result;
}

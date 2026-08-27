import type { User } from "@supabase/supabase-js";
import { adminCreditBalance, unwrapRelation } from "./credit-balance";
import { createAdminClient } from "@/lib/supabase-admin";
import type { AdminMemberRole, AdminSubscriptionStatus } from "./types";
import type {
  LiveMember,
  LiveUserDetail,
  LiveUserListRow,
  LiveWorkspaceDetail,
  LiveWorkspaceListRow,
} from "./live-types";

export type {
  LiveMember,
  LiveUserDetail,
  LiveUserListRow,
  LiveWorkspaceDetail,
  LiveWorkspaceListRow,
} from "./live-types";

export async function listAuthUsers(): Promise<User[]> {
  const admin = createAdminClient();
  const users: User[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const batch = data.users ?? [];
    users.push(...batch);
    if (batch.length < 200) break;
    page += 1;
    if (page > 50) break;
  }
  return users;
}

function userStatus(user: User): LiveUserListRow["status"] {
  const banned = (user as { banned_until?: string | null }).banned_until;
  if (banned && new Date(banned).getTime() > Date.now()) return "disabled";
  if (!user.last_sign_in_at) return "invited";
  return "active";
}

export function displayName(user: User, profileName: string | null | undefined): string {
  const name = profileName?.trim();
  if (name) return name;
  const meta = (user.user_metadata?.full_name as string | undefined)?.trim();
  if (meta) return meta;
  return user.email?.split("@")[0] || user.id;
}

export type LiveDirectory = {
  authUsers: User[];
  nameById: Map<string, string>;
  emailById: Map<string, string>;
  workspaceNameById: Map<string, string>;
};

export async function loadLiveDirectory(): Promise<LiveDirectory> {
  const admin = createAdminClient();
  const authUsers = await listAuthUsers();
  const [{ data: profiles, error: profileError }, { data: workspaces, error: workspaceError }] = await Promise.all([
    admin.from("profiles").select("id, full_name"),
    admin.from("workspaces").select("id, name"),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (workspaceError) throw new Error(workspaceError.message);

  const profileName = new Map(
    (profiles ?? []).map((row) => [row.id as string, row.full_name as string | null])
  );
  const nameById = new Map<string, string>();
  const emailById = new Map<string, string>();
  for (const user of authUsers) {
    emailById.set(user.id, user.email || "");
    nameById.set(user.id, displayName(user, profileName.get(user.id)));
  }
  for (const [id, name] of profileName) {
    if (!nameById.has(id) && name?.trim()) nameById.set(id, name.trim());
  }

  return {
    authUsers,
    nameById,
    emailById,
    workspaceNameById: new Map((workspaces ?? []).map((row) => [row.id as string, row.name as string])),
  };
}

export async function loadLiveUsers(): Promise<LiveUserListRow[]> {
  const admin = createAdminClient();
  const authUsers = await listAuthUsers();
  const ids = authUsers.map((user) => user.id);

  const [{ data: profiles, error: profileError }, { data: members, error: memberError }, { data: subs, error: subError }] =
    await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("workspace_members").select("user_id"),
    admin.from("user_subscriptions").select("user_id, status, plan_id, subscription_plans(name, display_name)"),
  ]);
  if (profileError) throw new Error(profileError.message);
  if (memberError) throw new Error(memberError.message);
  if (subError) throw new Error(subError.message);

  const nameById = new Map((profiles ?? []).map((row) => [row.id as string, row.full_name as string]));
  const memberCount = new Map<string, number>();
  for (const row of members ?? []) {
    const id = row.user_id as string;
    memberCount.set(id, (memberCount.get(id) ?? 0) + 1);
  }
  const subByUser = new Map(
    (subs ?? []).map((row) => {
      const plan = unwrapRelation(row.subscription_plans as { name?: string; display_name?: string } | { name?: string; display_name?: string }[] | null);
      return [
        row.user_id as string,
        {
          status: row.status as AdminSubscriptionStatus,
          planId: (plan?.name as string | null) ?? null,
          planName: plan?.display_name ?? plan?.name ?? null,
        },
      ];
    })
  );

  return authUsers
    .map((user) => {
      const sub = subByUser.get(user.id);
      return {
        id: user.id,
        fullName: displayName(user, nameById.get(user.id)),
        email: user.email || "",
        createdAt: user.created_at,
        lastSeenAt: user.last_sign_in_at ?? null,
        workspaceCount: memberCount.get(user.id) ?? 0,
        planName: sub?.planName ?? null,
        planId: sub?.planId ?? null,
        subscriptionStatus: sub?.status ?? null,
        status: userStatus(user),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function loadLiveWorkspaces(): Promise<LiveWorkspaceListRow[]> {
  const admin = createAdminClient();
  const authUsers = await listAuthUsers();
  const emailById = new Map(authUsers.map((user) => [user.id, user.email || ""]));
  const nameByAuth = new Map(
    authUsers.map((user) => [user.id, displayName(user, user.user_metadata?.full_name as string | undefined)])
  );

  const { data: workspaces, error } = await admin
    .from("workspaces")
    .select("id, name, slug, owner_id, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = workspaces ?? [];
  const ownerIds = [...new Set(rows.map((row) => row.owner_id as string))];

  const [{ data: profiles, error: profileError }, { data: members, error: memberError }, { data: wallets, error: walletError }, { data: integrations, error: integrationError }, { data: subs, error: subError }] =
    await Promise.all([
      admin.from("profiles").select("id, full_name").in("id", ownerIds.length ? ownerIds : ["00000000-0000-0000-0000-000000000000"]),
      admin.from("workspace_members").select("workspace_id"),
      admin.from("workspace_wallets").select("workspace_id, balance_usd"),
      admin.from("workspace_integrations").select("workspace_id, provider, status"),
      admin.from("user_subscriptions").select("user_id, status, billing_cycle, credits_used, bonus_credits, subscription_plans(name, display_name, monthly_ai_credits)"),
    ]);
  if (profileError) throw new Error(profileError.message);
  if (memberError) throw new Error(memberError.message);
  if (walletError) throw new Error(walletError.message);
  if (integrationError) throw new Error(integrationError.message);
  if (subError) throw new Error(subError.message);

  const profileName = new Map((profiles ?? []).map((row) => [row.id as string, row.full_name as string]));
  const memberCount = new Map<string, number>();
  for (const row of members ?? []) {
    const id = row.workspace_id as string;
    memberCount.set(id, (memberCount.get(id) ?? 0) + 1);
  }
  const walletByWs = new Map((wallets ?? []).map((row) => [row.workspace_id as string, Number(row.balance_usd ?? 0)]));
  const integrationByWs = new Map(
    (integrations ?? []).map((row) => [
      row.workspace_id as string,
      { provider: row.provider as string, status: row.status as string },
    ])
  );
  const subByUser = new Map(
    (subs ?? []).map((row) => {
      const plan = unwrapRelation(
        row.subscription_plans as {
          name?: string;
          display_name?: string;
          monthly_ai_credits?: number;
        } | {
          name?: string;
          display_name?: string;
          monthly_ai_credits?: number;
        }[] | null
      );
      const balance = adminCreditBalance({
        status: row.status as string,
        billingCycle: row.billing_cycle as string,
        creditsUsed: Number(row.credits_used ?? 0),
        bonusCredits: Number(row.bonus_credits ?? 0),
        monthlyAiCredits: Number(plan?.monthly_ai_credits ?? 0),
      });
      return [
        row.user_id as string,
        {
          planName: plan?.display_name ?? plan?.name ?? null,
          remaining: balance.remaining,
        },
      ];
    })
  );

  return rows.map((row) => {
    const ownerId = row.owner_id as string;
    const integration = integrationByWs.get(row.id as string);
    const sub = subByUser.get(ownerId);
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      ownerId,
      ownerName: profileName.get(ownerId) || nameByAuth.get(ownerId) || ownerId,
      ownerEmail: emailById.get(ownerId) || "",
      createdAt: row.created_at as string,
      memberCount: memberCount.get(row.id as string) ?? 0,
      planName: sub?.planName ?? null,
      creditsRemaining: sub?.remaining ?? null,
      walletUsd: walletByWs.get(row.id as string) ?? 0,
      integrationProvider: integration?.provider ?? null,
      integrationStatus: (integration?.status as LiveWorkspaceListRow["integrationStatus"]) ?? null,
    };
  });
}

export async function loadLiveUserDetail(id: string): Promise<LiveUserDetail | null> {
  const users = await loadLiveUsers();
  const user = users.find((row) => row.id === id);
  if (!user) return null;

  const admin = createAdminClient();
  const workspaces = await loadLiveWorkspaces();
  const { data: memberRows, error: memberError } = await admin
    .from("workspace_members")
    .select("workspace_id, user_id, role, joined_at")
    .eq("user_id", id);
  if (memberError) throw new Error(memberError.message);
  const { data: sub, error: subError } = await admin
    .from("user_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, credits_used, bonus_credits, billing_cycle, current_period_end, cancel_at_period_end, status, subscription_plans(monthly_ai_credits)")
    .eq("user_id", id)
    .maybeSingle();
  if (subError) throw new Error(subError.message);

  const wsById = new Map(workspaces.map((row) => [row.id, row]));
  const memberships: LiveMember[] = (memberRows ?? []).map((row) => ({
    workspaceId: row.workspace_id as string,
    workspaceName: wsById.get(row.workspace_id as string)?.name || row.workspace_id,
    userId: id,
    fullName: user.fullName,
    email: user.email,
    role: row.role as AdminMemberRole,
    joinedAt: row.joined_at as string,
  }));

  const plan = unwrapRelation(
    sub?.subscription_plans as { monthly_ai_credits?: number } | { monthly_ai_credits?: number }[] | null
  );
  const balance = sub
    ? adminCreditBalance({
        status: (sub.status as string) || user.subscriptionStatus,
        billingCycle: sub.billing_cycle as string,
        creditsUsed: Number(sub.credits_used ?? 0),
        bonusCredits: Number(sub.bonus_credits ?? 0),
        monthlyAiCredits: Number(plan?.monthly_ai_credits ?? 0),
      })
    : null;

  return {
    ...user,
    ownedWorkspaces: workspaces.filter((row) => row.ownerId === id),
    memberships,
    stripeCustomerId: (sub?.stripe_customer_id as string | null) ?? null,
    stripeSubscriptionId: (sub?.stripe_subscription_id as string | null) ?? null,
    creditsUsed: sub ? Number(sub.credits_used ?? 0) : null,
    bonusCredits: sub ? Number(sub.bonus_credits ?? 0) : null,
    creditsRemaining: balance?.remaining ?? null,
    periodCredits: balance?.periodCredits ?? null,
    billingCycle: (sub?.billing_cycle as string | null) ?? null,
    currentPeriodEnd: (sub?.current_period_end as string | null) ?? null,
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
  };
}

export async function loadLiveWorkspaceDetail(id: string): Promise<LiveWorkspaceDetail | null> {
  const workspaces = await loadLiveWorkspaces();
  const workspace = workspaces.find((row) => row.id === id);
  if (!workspace) return null;
  const admin = createAdminClient();
  const { data: memberRows, error: memberError } = await admin
    .from("workspace_members")
    .select("workspace_id, user_id, role, joined_at")
    .eq("workspace_id", id);
  if (memberError) throw new Error(memberError.message);
  const users = await loadLiveUsers();
  const userById = new Map(users.map((row) => [row.id, row]));

  return {
    ...workspace,
    members: (memberRows ?? []).map((row) => {
      const member = userById.get(row.user_id as string);
      return {
        workspaceId: id,
        workspaceName: workspace.name,
        userId: row.user_id as string,
        fullName: member?.fullName ?? row.user_id,
        email: member?.email ?? "",
        role: row.role as AdminMemberRole,
        joinedAt: row.joined_at as string,
      };
    }),
  };
}

export async function searchLiveDirectory(query: string): Promise<{
  users: LiveUserListRow[];
  workspaces: LiveWorkspaceListRow[];
}> {
  const q = query.trim().toLowerCase();
  if (!q) return { users: [], workspaces: [] };
  const [users, workspaces] = await Promise.all([loadLiveUsers(), loadLiveWorkspaces()]);
  return {
    users: users
      .filter(
        (user) =>
          user.fullName.toLowerCase().includes(q) ||
          user.email.toLowerCase().includes(q) ||
          user.id.toLowerCase().includes(q)
      )
      .slice(0, 6),
    workspaces: workspaces
      .filter(
        (workspace) =>
          workspace.name.toLowerCase().includes(q) ||
          workspace.slug.toLowerCase().includes(q) ||
          workspace.ownerEmail.toLowerCase().includes(q)
      )
      .slice(0, 6),
  };
}

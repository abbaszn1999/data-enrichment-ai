import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Building2,
  Coins,
  CreditCard,
  LayoutDashboard,
  Plug,
  ScrollText,
  Users,
  Wallet,
} from "lucide-react";
import { adminRoutes } from "./paths";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  group: "Command" | "Customers" | "Money" | "Ops";
};

export const ADMIN_NAV: AdminNavItem[] = [
  { href: adminRoutes.overview(), label: "Overview", icon: LayoutDashboard, group: "Command" },
  { href: adminRoutes.users(), label: "Users", icon: Users, group: "Customers" },
  { href: adminRoutes.workspaces(), label: "Workspaces", icon: Building2, group: "Customers" },
  { href: adminRoutes.subscriptions(), label: "Subscriptions", icon: CreditCard, group: "Money" },
  { href: adminRoutes.credits(), label: "Credits", icon: Coins, group: "Money" },
  { href: adminRoutes.wallet(), label: "Wallet", icon: Wallet, group: "Money" },
  { href: adminRoutes.jobs(), label: "Jobs", icon: Activity, group: "Ops" },
  { href: adminRoutes.integrations(), label: "Integrations", icon: Plug, group: "Ops" },
  { href: adminRoutes.audit(), label: "Activity", icon: ScrollText, group: "Ops" },
];

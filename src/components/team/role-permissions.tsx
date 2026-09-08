"use client";

import type { ComponentType } from "react";
import {
  Bot,
  Boxes,
  Check,
  CreditCard,
  Crown,
  Eye,
  FolderTree,
  Image as ImageIcon,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  Paintbrush,
  Package,
  PenLine,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Owner, Admin, Editor, Viewer */
type Access = readonly [boolean, boolean, boolean, boolean];

const ALL: Access = [true, true, true, true];
const EDITOR: Access = [true, true, true, false];
const ADMIN: Access = [true, true, false, false];
const OWNER: Access = [true, false, false, false];

type PermRow = {
  page: string;
  action: string;
  access: Access;
};

type PermGroup = {
  label: string;
  rows: PermRow[];
};

const ROLES: {
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  iconWrap: string;
  text: string;
}[] = [
  {
    label: "Owner",
    hint: "Full control, including member roles, billing, and workspace deletion",
    icon: Crown,
    iconWrap: "bg-amber-500/12 text-amber-500",
    text: "text-amber-500",
  },
  {
    label: "Admin",
    hint: "Operate and administer, except billing and roles",
    icon: ShieldCheck,
    iconWrap: "bg-violet-500/12 text-violet-500",
    text: "text-violet-500",
  },
  {
    label: "Editor",
    hint: "Run tools and edit catalog, no deletes",
    icon: PenLine,
    iconWrap: "bg-blue-500/12 text-blue-500",
    text: "text-blue-500",
  },
  {
    label: "Viewer",
    hint: "Open pages and inspect data only",
    icon: Eye,
    iconWrap: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
  },
];

const GROUPS: PermGroup[] = [
  {
    label: "Overview",
    rows: [
      { page: "Dashboard", action: "View workspace overview", access: ALL },
      { page: "Products", action: "View catalog", access: ALL },
      { page: "Products", action: "Edit / select products", access: EDITOR },
      { page: "Products", action: "Delete all products", access: ADMIN },
      { page: "Categories", action: "View taxonomy", access: ALL },
      { page: "Categories", action: "Manage category tree", access: ADMIN },
      { page: "Catalog Intelligence", action: "View enrichment sessions", access: ALL },
      { page: "Catalog Intelligence", action: "New catalog / enrich", access: EDITOR },
      { page: "Catalog Intelligence", action: "Delete sessions", access: ADMIN },
    ],
  },
  {
    label: "Visual Intelligence",
    rows: [
      { page: "Image Classification", action: "View projects", access: ALL },
      { page: "Image Classification", action: "New classification", access: EDITOR },
      { page: "Image Classification", action: "Delete projects", access: ADMIN },
      { page: "Products Gallery", action: "View projects", access: ALL },
      { page: "Products Gallery", action: "New project / generate", access: EDITOR },
      { page: "Products Gallery", action: "Delete projects", access: ADMIN },
      { page: "Products Visualizer", action: "View projects", access: ALL },
      { page: "Products Visualizer", action: "New project / generate", access: EDITOR },
      { page: "Products Visualizer", action: "Delete projects", access: ADMIN },
    ],
  },
  {
    label: "Growth engine",
    rows: [
      { page: "Market research", action: "View projects", access: ALL },
      { page: "Market research", action: "New project / run analysis", access: EDITOR },
      { page: "Market research", action: "Delete projects", access: ADMIN },
      { page: "Customize", action: "View widgets & prefix", access: ALL },
      { page: "Customize", action: "Save styles & naming prefix", access: EDITOR },
      { page: "Growth Sync", action: "View rules & activity", access: ALL },
      { page: "Growth Sync", action: "New rule / run / undo", access: EDITOR },
      { page: "Growth Sync", action: "Delete rules", access: ADMIN },
      { page: "Wallet", action: "View balance & statement", access: ALL },
      { page: "Wallet", action: "Add funds", access: EDITOR },
    ],
  },
  {
    label: "Tools",
    rows: [
      { page: "Website restructure", action: "View header projects", access: ALL },
      { page: "Website restructure", action: "New project / build / edit", access: EDITOR },
      { page: "Website restructure", action: "Delete projects", access: ADMIN },
      { page: "Store assistant", action: "View chat & sheet", access: ALL },
      { page: "Store assistant", action: "Send messages / apply to store", access: EDITOR },
      { page: "Usage", action: "View credit usage", access: ALL },
    ],
  },
  {
    label: "Account",
    rows: [
      { page: "Team", action: "Invite members", access: ADMIN },
      { page: "Team", action: "Change member roles", access: OWNER },
      { page: "Settings", action: "Workspace & integrations", access: ADMIN },
      { page: "Subscription", action: "Manage plan & billing", access: OWNER },
      { page: "Workspace", action: "Delete workspace", access: OWNER },
    ],
  },
];

const PAGE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Dashboard: LayoutDashboard,
  Products: Package,
  Categories: FolderTree,
  "Catalog Intelligence": Upload,
  "Image Classification": ImageIcon,
  "Products Gallery": Images,
  "Products Visualizer": Boxes,
  "Market research": Search,
  Customize: Paintbrush,
  Sync: RefreshCw,
  Wallet: Wallet,
  "Website restructure": LayoutTemplate,
  "Store assistant": Bot,
  Usage: CreditCard,
  Team: Users,
  Settings: Settings,
  Subscription: Crown,
  Workspace: ShieldCheck,
};

function AccessCell({ allowed }: { allowed: boolean }) {
  if (allowed) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/12 ring-1 ring-inset ring-emerald-500/20"
        aria-label="Allowed"
      >
        <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center text-[13px] font-semibold text-muted-foreground/30"
      aria-label="Not allowed"
    >
      —
    </span>
  );
}

export function RolePermissions() {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 bg-muted/20 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-black tracking-tight">Role permissions</h2>
            <p className="text-[11px] text-muted-foreground">
              Every page and action in this workspace, by role
            </p>
          </div>
        </div>
        <p className="max-w-sm text-right text-[10px] leading-relaxed text-muted-foreground">
          Every member can open the pages. Create, edit, and delete follow the
          columns.
        </p>
      </div>

      <div className="grid gap-px border-b border-border/60 bg-border/60 sm:grid-cols-4">
        {ROLES.map((role) => (
          <div
            key={role.label}
            className="flex items-start gap-3 bg-card px-4 py-3.5"
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                role.iconWrap
              )}
            >
              <role.icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className={cn("block text-[11px] font-bold", role.text)}>
                {role.label}
              </span>
              <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                {role.hint}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="max-h-[480px] overflow-auto overscroll-contain [scrollbar-gutter:stable]">
        <table className="w-full min-w-[720px] text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border/60">
              <th className="bg-card px-5 py-3 text-left font-semibold text-muted-foreground">
                Page / action
              </th>
              {ROLES.map((role) => (
                <th key={role.label} className="bg-card px-3 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <role.icon className={cn("h-3.5 w-3.5", role.text)} />
                    <span className={cn("font-bold", role.text)}>{role.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((group) => (
              <GroupRows key={group.label} group={group} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GroupRows({ group }: { group: PermGroup }) {
  return (
    <>
      <tr className="border-b border-border/50 bg-muted/35">
        <td
          colSpan={5}
          className="px-5 py-2"
        >
          <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#400095] dark:text-[#F76D01]">
            {group.label}
          </span>
        </td>
      </tr>
      {group.rows.map((row, index) => {
        const Icon = PAGE_ICONS[row.page];
        const showPage = index === 0 || group.rows[index - 1].page !== row.page;
        return (
          <tr
            key={`${row.page}-${row.action}`}
            className="border-b border-border/40 last:border-0 hover:bg-muted/25"
          >
            <td className="px-5 py-2.5">
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                    showPage
                      ? "bg-muted text-muted-foreground"
                      : "text-transparent"
                  )}
                >
                  {Icon ? <Icon className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-[11px] font-semibold text-foreground",
                      !showPage && "invisible"
                    )}
                  >
                    {row.page}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {row.action}
                  </span>
                </span>
              </div>
            </td>
            {row.access.map((allowed, i) => (
              <td key={ROLES[i].label} className="px-3 py-2.5 text-center">
                <AccessCell allowed={allowed} />
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  Bot,
  Clock,
  LayoutTemplate,
  Library,
  Lock,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
import { useWorkspaceContext } from "../workspace-context";

type LibraryAgent = {
  /** Path under /w/[slug]; null while the agent is not built yet. */
  path: string | null;
  name: string;
  blurb: string;
  icon: LucideIcon;
  /** Literal classes so Tailwind keeps them. */
  tone: { icon: string; glow: string };
  points: string[];
  needsIntegration?: boolean;
};

const AGENTS: LibraryAgent[] = [
  {
    path: "/website-restructure",
    name: "Website restructure",
    blurb: "Rebuilds your storefront header and navigation through chat, with a live preview and version history.",
    icon: LayoutTemplate,
    tone: { icon: "bg-violet-500/10 text-violet-500 ring-violet-500/20", glow: "from-violet-500/15" },
    points: ["Header and menu builder", "Live preview", "Version history"],
    needsIntegration: true,
  },
  {
    path: "/store-assistant",
    name: "Store assistant",
    blurb: "Chat with an agent that reads and edits your store: products, collections and content, on request.",
    icon: Bot,
    tone: { icon: "bg-sky-500/10 text-sky-500 ring-sky-500/20", glow: "from-sky-500/15" },
    points: ["Edits products in chat", "Works on your live store", "Asks before it changes"],
    needsIntegration: true,
  },
  {
    path: null,
    name: "Google Ads",
    blurb: "An agent that plans, writes and tunes Google Ads campaigns from your catalog.",
    icon: Megaphone,
    tone: { icon: "bg-amber-500/10 text-amber-500 ring-amber-500/20", glow: "from-amber-500/15" },
    points: ["Campaigns from your catalog", "Ad copy and keywords", "Budget suggestions"],
  },
];

function AgentCard({
  agent,
  href,
  state,
  index,
}: {
  agent: LibraryAgent;
  href: string | null;
  state: "ready" | "locked" | "soon";
  index: number;
}) {
  const Icon = agent.icon;
  const card = (
    <motion.div
      whileHover={state === "soon" ? undefined : { y: -4 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card p-5 shadow-sm ${
        state === "soon" ? "cursor-not-allowed border-border/40" : "border-border/60 hover:border-border hover:shadow-xl hover:shadow-black/[0.04]"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b ${agent.tone.glow} to-transparent ${
          state === "soon" ? "opacity-40" : "opacity-60 transition-opacity group-hover:opacity-100"
        }`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ${agent.tone.icon}`}>
          <Icon className="h-6 w-6" />
        </span>
        {state === "soon" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            <Clock className="h-3 w-3" /> Soon
          </span>
        ) : (
          <ArrowUpRight className="h-5 w-5 text-muted-foreground/40 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
        )}
      </div>

      <div className={`relative mt-5 space-y-1.5 ${state === "soon" ? "opacity-60" : ""}`}>
        <h2 className="text-lg font-black tracking-tight">{agent.name}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{agent.blurb}</p>
      </div>

      <ul className={`relative mt-4 space-y-1.5 ${state === "soon" ? "opacity-60" : ""}`}>
        {agent.points.map((point) => (
          <li key={point} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-current" />
            {point}
          </li>
        ))}
      </ul>

      <div className="relative mt-auto pt-5">
        {state === "ready" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ready
          </span>
        )}
        {state === "locked" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            <Lock className="h-3 w-3" /> Connect a store
          </span>
        )}
        {state === "soon" && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            In development
          </span>
        )}
      </div>
    </motion.div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="h-full"
    >
      {href ? (
        <Link href={href} className="block h-full">
          {card}
        </Link>
      ) : (
        <div aria-disabled className="h-full">
          {card}
        </div>
      )}
    </motion.div>
  );
}

export default function LibraryPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace, hasIntegration } = useWorkspaceContext();
  const basePath = `/w/${slug}`;

  return (
    <div className="autommerce-dashboard flex-1 overflow-auto bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-6 py-7">
          <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                <Library className="h-4 w-4" />
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                Agents
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
              Agent
              <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                Library
              </span>
            </h1>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Every agent that can work on{" "}
              <span className="font-medium text-foreground">{workspace?.name ?? "your store"}</span>. Open one to start.
            </p>
          </motion.header>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent, index) => {
            const state = !agent.path ? "soon" : agent.needsIntegration && !hasIntegration ? "locked" : "ready";
            // Agents that need a store send you to Settings to connect one first.
            const href =
              state === "soon" ? null : state === "locked" ? `${basePath}/settings` : `${basePath}${agent.path}`;
            return <AgentCard key={agent.name} agent={agent} href={href} state={state} index={index} />;
          })}
        </div>
      </div>
    </div>
  );
}

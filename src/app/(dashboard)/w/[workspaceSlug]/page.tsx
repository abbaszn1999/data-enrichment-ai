"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Bot,
  Boxes,
  CircleDollarSign,
  Crown,
  FileSearch,
  FolderTree,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  LayoutTemplate,
  Loader2,
  Lock,
  Package,
  Paintbrush,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Upload,
  Users,
  Wallet,
  WandSparkles,
  Zap,
} from "lucide-react";
import { useWorkspaceContext } from "./workspace-context";
import { useRole } from "@/hooks/use-role";
import { useCredits } from "@/hooks/use-credits";
import { useWallet } from "@/hooks/use-wallet";
import { useDashboardSummary } from "@/hooks/use-dashboard";
import { formatCredits } from "@/lib/format-credits";
import { formatMoney } from "@/lib/wallet/format";
import { matchesQuery, visibleTools } from "@/components/dashboard/tools-catalog";

type MissionTool = {
  name: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  note: string;
  locked?: boolean;
};

function StatusPulse() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
    </span>
  );
}

function AgentConstellation({ basePath }: { basePath: string }) {
  const agents = [
    { name: "Research", icon: Search, path: "/market-research", x: "4%", y: "12%", delay: 0 },
    { name: "Visuals", icon: Images, path: "/products-gallery", x: "73%", y: "7%", delay: 0.2 },
    { name: "Store", icon: Bot, path: "/sync", x: "77%", y: "70%", delay: 0.4 },
    { name: "Catalog", icon: WandSparkles, path: "/import", x: "2%", y: "72%", delay: 0.6 },
  ];
  const paths = [
    "M 235 165 C 192 130, 170 100, 120 78",
    "M 235 165 C 280 125, 310 82, 365 65",
    "M 235 165 C 285 195, 315 225, 372 248",
    "M 235 165 C 190 200, 158 230, 108 250",
  ];
  const particles = Array.from({ length: 18 }, (_, index) => {
    const angle = (index / 18) * Math.PI * 2;
    const radius = index % 2 === 0 ? 92 : 125;
    return {
      x: 235 + Math.cos(angle) * radius,
      y: 165 + Math.sin(angle) * radius * 0.72,
      size: index % 3 === 0 ? 2.2 : 1.4,
      delay: index * 0.12,
    };
  });

  return (
    <div className="relative mx-auto h-[360px] w-full max-w-[500px]">
      <svg
        viewBox="0 0 470 330"
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      >
        <defs>
          <linearGradient id="agent-flow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F76D01" />
            <stop offset="48%" stopColor="#C40000" />
            <stop offset="100%" stopColor="#400095" />
          </linearGradient>
          <radialGradient id="agent-halo">
            <stop offset="0%" stopColor="#C8A8D2" stopOpacity=".28" />
            <stop offset="55%" stopColor="#F76D01" stopOpacity=".08" />
            <stop offset="100%" stopColor="#400095" stopOpacity="0" />
          </radialGradient>
          <filter id="agent-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <motion.ellipse
          cx="235"
          cy="165"
          rx="156"
          ry="116"
          fill="url(#agent-halo)"
          animate={{ rx: [150, 170, 150], ry: [110, 122, 110], opacity: [.7, 1, .7] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        {[68, 104, 142].map((radius, index) => (
          <motion.ellipse
            key={radius}
            cx="235"
            cy="165"
            rx={radius}
            ry={radius * 0.72}
            fill="none"
            stroke={index === 1 ? "url(#agent-flow)" : "currentColor"}
            strokeWidth={index === 1 ? "0.8" : "0.5"}
            strokeDasharray={index === 1 ? "5 8" : "2 7"}
            className="text-slate-500/20 dark:text-white/15"
            animate={{ rotate: index % 2 === 0 ? 360 : -360 }}
            style={{ transformOrigin: "235px 165px" }}
            transition={{
              duration: 20 + index * 7,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}

        {paths.map((path, index) => (
          <g key={path}>
            <path
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth=".7"
              className="text-slate-500/15 dark:text-white/10"
            />
            <motion.path
              d={path}
              fill="none"
              stroke="url(#agent-flow)"
              strokeWidth="1.8"
              strokeLinecap="round"
              filter="url(#agent-glow)"
              initial={{ pathLength: 0, pathOffset: 0, opacity: 0 }}
              animate={{
                pathLength: [0, 0.28, 0.28, 0],
                pathOffset: [0, 0, 0.72, 1],
                opacity: [0, 1, 1, 0],
              }}
              transition={{
                duration: 3.4,
                delay: index * 0.7,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </g>
        ))}

        {particles.map((particle, index) => (
          <motion.circle
            key={index}
            cx={particle.x}
            cy={particle.y}
            r={particle.size}
            fill={index % 2 === 0 ? "#400095" : "#F76D01"}
            filter="url(#agent-glow)"
            animate={{
              opacity: [.2, 1, .2],
              r: [particle.size * .7, particle.size * 1.35, particle.size * .7],
            }}
            transition={{
              duration: 2.6,
              delay: particle.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </svg>

      <div className="absolute left-1/2 top-[49%] -translate-x-1/2 -translate-y-1/2">
        <motion.div
          whileHover={{ scale: 1.08 }}
          animate={{
            boxShadow: [
              "0 0 30px rgba(64,0,149,.25), inset 0 0 25px rgba(255,255,255,.18)",
              "0 0 95px rgba(247,109,1,.38), inset 0 0 38px rgba(255,255,255,.3)",
              "0 0 30px rgba(196,0,0,.25), inset 0 0 25px rgba(255,255,255,.18)",
            ],
            scale: [1, 1.035, 1],
          }}
          transition={{ duration: 4, repeat: Infinity }}
          className="relative flex h-32 w-32 cursor-pointer items-center justify-center rounded-full border border-slate-900/10 bg-white/75 shadow-xl backdrop-blur-xl dark:border-white/15 dark:bg-white/[0.07]"
        >
          <motion.div
            className="absolute inset-1 rounded-full bg-[conic-gradient(from_0deg,transparent,#F76D01,transparent,#C40000,transparent,#400095,transparent)] opacity-80"
            animate={{ rotate: 360 }}
            transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
          />
          <div className="absolute inset-2 rounded-full bg-white dark:bg-[#11131c]" />
          <motion.div
            className="absolute inset-5 rounded-full bg-gradient-to-br from-[#F76D01] via-[#C40000] to-[#400095]"
            animate={{
              borderRadius: ["50% 45% 55% 48%", "44% 56% 46% 54%", "50% 45% 55% 48%"],
              rotate: [0, 12, 0],
            }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute inset-7 rounded-full bg-white/20 blur-md"
            animate={{ scale: [.8, 1.25, .8], opacity: [.25, .75, .25] }}
            transition={{ duration: 2.8, repeat: Infinity }}
          />
          <Sparkles className="relative h-10 w-10 text-white drop-shadow-[0_0_10px_rgba(255,255,255,.8)]" />
        </motion.div>
        <div className="mt-4 text-center">
          <div className="text-xs font-black text-slate-950 dark:text-white">AI Core</div>
          <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[8px] uppercase tracking-[.24em] text-[#400095] dark:text-[#C8A8D2]">
            <StatusPulse /> live orchestration
          </div>
        </div>
      </div>

      {agents.map((agent) => (
        <motion.div
          key={agent.name}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1, y: [0, -9, 0] }}
          transition={{
            opacity: { delay: agent.delay, duration: 0.4 },
            scale: { delay: agent.delay, duration: 0.4 },
            y: { delay: agent.delay, duration: 3.5, repeat: Infinity, ease: "easeInOut" },
          }}
          className="absolute"
          style={{ left: agent.x, top: agent.y }}
        >
          <Link
            href={`${basePath}${agent.path}`}
            className="group flex items-center gap-2 rounded-2xl border border-slate-900/10 bg-white/80 p-2 pr-3 text-slate-950 shadow-[0_10px_35px_rgba(15,23,42,.12)] backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-[#6B358D]/50 hover:bg-white hover:shadow-[0_16px_45px_rgba(64,0,149,.18)] dark:border-white/10 dark:bg-white/[0.07] dark:text-white dark:hover:border-[#C8A8D2]/35 dark:hover:bg-white/[0.12]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095]/10 dark:bg-white/10">
              <agent.icon className="h-4 w-4 text-[#400095] dark:text-[#C8A8D2]" />
            </span>
            <span>
              <span className="block text-[10px] font-bold">{agent.name}</span>
              <span className="block text-[8px] text-slate-500 dark:text-white/35">agent ready</span>
            </span>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

function ToolRow({
  tool,
  basePath,
}: {
  tool: MissionTool;
  basePath: string;
}) {
  const Icon = tool.icon;
  const href = tool.locked ? `${basePath}/settings` : `${basePath}${tool.path}`;
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-all hover:border-border/60 hover:bg-background/70"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/80 shadow-sm ring-1 ring-border/60 transition-transform group-hover:scale-110">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-bold">
          {tool.name}
          {tool.locked && <Lock className="h-2.5 w-2.5 text-amber-500" />}
        </span>
        <span className="block truncate text-[9px] text-muted-foreground">{tool.note}</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 -translate-x-1 text-muted-foreground/0 transition-all group-hover:translate-x-0 group-hover:text-muted-foreground" />
    </Link>
  );
}

function JourneyMap() {
  const stages = [
    { label: "Connect", icon: PlugZap, color: "bg-[#F76D01]", text: "Store" },
    { label: "Understand", icon: FileSearch, color: "bg-[#C40000]", text: "Research" },
    { label: "Enrich", icon: WandSparkles, color: "bg-[#400095]", text: "Catalog" },
    { label: "Create", icon: Images, color: "bg-[#6B358D]", text: "Visuals" },
    { label: "Automate", icon: RefreshCw, color: "bg-[#79081D]", text: "Growth" },
  ];
  return (
    <section className="overflow-hidden rounded-[28px] border border-border/60 bg-card px-5 py-6 sm:px-8">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.25em] text-primary">One system</p>
          <h2 className="mt-1 text-xl font-black">Your autonomous commerce loop</h2>
        </div>
        <p className="hidden max-w-xs text-right text-[10px] leading-relaxed text-muted-foreground md:block">
          Every agent feeds the next one. Your store gets smarter without moving data between tools.
        </p>
      </div>
      <div className="relative grid grid-cols-5">
        <div className="absolute left-[10%] right-[10%] top-5 h-px bg-border">
          <motion.div
            className="h-px bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]"
            initial={{ width: 0 }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.5, delay: 0.3 }}
          />
          <motion.span
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_12px_#F76D01]"
            animate={{ left: ["0%", "100%"] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
        {stages.map((stage, i) => (
          <motion.div
            key={stage.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 * i }}
            className="relative flex flex-col items-center text-center"
          >
            <span className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full ${stage.color} text-white shadow-lg ring-4 ring-card`}>
              <stage.icon className="h-4 w-4" />
            </span>
            <span className="mt-3 text-[10px] font-bold sm:text-xs">{stage.label}</span>
            <span className="mt-0.5 hidden text-[8px] uppercase tracking-wider text-muted-foreground sm:block">{stage.text}</span>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

export default function WorkspaceDashboardPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const basePath = `/w/${slug}`;
  const { workspace, role, wsLoading, hasIntegration } = useWorkspaceContext();
  const permissions = useRole(role);
  const credits = useCredits(workspace?.id ?? null);
  const { wallet } = useWallet(workspace?.id ?? null);
  const { data, isLoading } = useDashboardSummary(workspace?.id ?? null);
  const [command, setCommand] = useState("");
  const [greeting, setGreeting] = useState("Welcome");

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  const searchResults = useMemo(() => {
    if (!command.trim()) return [];
    return visibleTools({ canAdmin: permissions.canAdmin, isOwner: permissions.isOwner })
      .filter((tool) => matchesQuery(tool, command))
      .slice(0, 5);
  }, [command, permissions.canAdmin, permissions.isOwner]);

  const stats = data?.stats;
  const locked = !hasIntegration;
  const missions: {
    id: string;
    eyebrow: string;
    title: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    href: string;
    action: string;
    className: string;
    surface: string;
    tools: MissionTool[];
  }[] = [
    {
      id: "catalog",
      eyebrow: "01 · Data foundation",
      title: "Turn messy data into a living catalog",
      description: "Import, understand and organize every product before your agents act on it.",
      icon: WandSparkles,
      href: "/import",
      action: "Start an intelligent import",
      className: "lg:col-span-7",
      surface: "from-[#400095]/15 via-card to-card",
      tools: [
        { name: "Catalog Intelligence", path: "/import", icon: Upload, note: "Map and enrich spreadsheets with web research" },
        { name: "Products", path: "/products", icon: Package, note: `${stats?.totalProducts ?? 0} products in the master catalog` },
        { name: "Categories", path: "/categories", icon: FolderTree, note: `${stats?.totalCategories ?? 0} categories in your taxonomy` },
      ],
    },
    {
      id: "research",
      eyebrow: "02 · Demand intelligence",
      title: "Find what the market wants next",
      description: "Discover niches, keywords and content opportunities, then publish them.",
      icon: Search,
      href: "/market-research",
      action: "Launch research agent",
      className: "lg:col-span-5",
      surface: "from-[#F76D01]/15 via-card to-card",
      tools: [
        { name: "Market Research", path: "/market-research", icon: Search, note: "7-stage SEO and content agent", locked },
        { name: "Customize", path: "/customize", icon: Paintbrush, note: "Storefront blocks and AI naming", locked },
      ],
    },
    {
      id: "visual",
      eyebrow: "03 · Creative studio",
      title: "Give every product a visual world",
      description: "Generate photography, lifestyle scenes and rich product storytelling.",
      icon: Images,
      href: "/products-gallery",
      action: "Open visual studio",
      className: "lg:col-span-5",
      surface: "from-[#6B358D]/15 via-card to-card",
      tools: [
        { name: "Products Gallery", path: "/products-gallery", icon: LayoutGrid, note: "Generate product photography at scale" },
        { name: "Products Visualizer", path: "/products-visualizer", icon: Boxes, note: "Descriptions and lifestyle imagery" },
        { name: "Image Classification", path: "/image-classify", icon: ImageIcon, note: "Match image folders to SKUs" },
      ],
    },
    {
      id: "operate",
      eyebrow: "04 · Autonomous operations",
      title: "Put the store on autopilot",
      description: "Talk to your store, rebuild its navigation and classify new products every day.",
      icon: Bot,
      href: "/sync",
      action: "Talk to store assistant",
      className: "lg:col-span-7",
      surface: "from-[#C40000]/15 via-card to-card",
      tools: [
        { name: "Store Assistant", path: "/sync", icon: Bot, note: "A conversational store operator", locked },
        { name: "Website Restructure", path: "/website-restructure", icon: LayoutTemplate, note: "Rebuild headers through chat", locked },
        { name: "24h Sync", path: "/growth-sync", icon: RefreshCw, note: "Classify every new product automatically", locked },
      ],
    },
  ];

  if (wsLoading || isLoading) {
    return (
      <div className="flex h-full min-h-96 items-center justify-center bg-[#080a0f]">
        <div className="text-center text-white">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#F76D01]" />
          <p className="mt-3 text-xs text-white/40">Starting the AI core…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      {/* A true command-center hero, visually separated from the ordinary app chrome. */}
      <section className="relative z-20 min-h-[510px] overflow-visible border-b border-border/60 bg-[#f5f7fb] text-slate-950 dark:border-transparent dark:bg-[#080a0f] dark:text-white">
        <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(15,23,42,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,.045)_1px,transparent_1px)] [background-size:48px_48px] dark:opacity-40 dark:[background-image:linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)]" />
        <motion.div
          className="absolute -left-24 top-4 h-72 w-72 rounded-full bg-[#400095]/20 blur-[90px]"
          animate={{ x: [0, 80, 0], y: [0, 35, 0] }}
          transition={{ duration: 12, repeat: Infinity }}
        />
        <motion.div
          className="absolute right-[20%] top-20 h-72 w-72 rounded-full bg-[#F76D01]/15 blur-[100px]"
          animate={{ x: [0, -60, 0], y: [0, 55, 0] }}
          transition={{ duration: 15, repeat: Infinity }}
        />

        <div className="relative mx-auto grid min-h-[510px] max-w-[1450px] items-center gap-6 px-6 py-10 lg:grid-cols-[1.05fr_.95fr] lg:px-10">
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            className="max-w-2xl"
          >
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.22em] text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300">
                <StatusPulse /> AI network online
              </span>
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.22em] ${hasIntegration ? "border-[#400095]/20 bg-[#400095]/10 text-[#400095] dark:border-[#C8A8D2]/20 dark:bg-[#C8A8D2]/10 dark:text-[#C8A8D2]" : "border-[#F76D01]/25 bg-[#F76D01]/10 text-[#C40000] dark:border-[#F76D01]/25 dark:bg-[#F76D01]/10 dark:text-[#F76D01]"}`}>
                <PlugZap className="h-3 w-3" />
                {hasIntegration ? "Store connected" : "Store connection required"}
              </span>
            </div>
            <p className="text-xs font-medium text-slate-500 dark:text-white/40">{greeting}, {workspace?.name}</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-black leading-[1.16] tracking-[-.045em] sm:text-5xl xl:text-6xl">
              <span className="block">Don&apos;t manage tools.</span>
              <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-2 text-transparent">
                Command intelligence.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-600 dark:text-white/50">
              Your agents share one catalog, one store and one memory. Tell the system the outcome you want—then let the right intelligence take over.
            </p>

            <div className="relative mt-7 max-w-xl">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-900/10 bg-white/80 p-2 pl-4 shadow-xl backdrop-blur-xl focus-within:border-[#6B358D]/60 dark:border-white/15 dark:bg-white/[0.07] dark:shadow-2xl">
                <Sparkles className="h-4 w-4 shrink-0 text-[#400095] dark:text-[#C8A8D2]" />
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder='What do you want to do? Try “research my market”…'
                  className="h-9 min-w-0 flex-1 bg-transparent text-xs text-slate-950 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/30"
                />
                <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white transition-transform hover:scale-105 dark:bg-white dark:text-black">
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
              <AnimatePresence>
                {command.trim() && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    className="absolute inset-x-0 top-full z-50 mt-2 max-h-[310px] overflow-y-auto rounded-2xl border border-slate-900/10 bg-white/95 p-2 text-slate-950 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#12141c]/95 dark:text-white"
                  >
                    {searchResults.length > 0 ? searchResults.map((tool) => (
                      <Link
                        key={tool.path}
                        href={`${basePath}${tool.path}`}
                        className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.07]"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#400095]/10 dark:bg-white/10">
                          <tool.icon className="h-4 w-4 text-[#400095] dark:text-[#C8A8D2]" />
                        </span>
                        <span className="flex-1">
                          <span className="block text-xs font-bold">{tool.name}</span>
                          <span className="block truncate text-[9px] text-slate-500 dark:text-white/35">{tool.blurb}</span>
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-white/30" />
                      </Link>
                    )) : (
                      <p className="p-3 text-xs text-slate-500 dark:text-white/40">No matching intelligence found.</p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          <AgentConstellation basePath={basePath} />
        </div>
      </section>

      {/* Live resources ribbon, deliberately not a row of generic cards. */}
      <div className="relative z-10 border-b border-border/60 bg-card shadow-[0_10px_35px_rgba(15,23,42,.035)]">
        <div className="mx-auto flex max-w-[1450px] divide-x divide-border/60 overflow-x-auto px-3 lg:px-7">
          {[
            { label: "Catalog", value: `${stats?.totalProducts ?? 0} products`, icon: Package, href: "/products" },
            { label: "Taxonomy", value: `${stats?.totalCategories ?? 0} categories`, icon: FolderTree, href: "/categories" },
            { label: "AI credits", value: `${formatCredits(credits.remaining)} available`, icon: Zap, href: "/usage" },
            { label: "Agent wallet", value: wallet ? formatMoney(wallet.balance) : "—", icon: Wallet, href: "/wallet" },
            { label: "Collaborators", value: `${stats?.teamMembers ?? 0} people`, icon: Users, href: permissions.canAdmin ? "/team" : "" },
          ].map((item) => (
            <Link key={item.label} href={`${basePath}${item.href}`} className="group flex min-w-[220px] flex-1 items-center gap-4 px-6 py-5 transition-colors hover:bg-muted/50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 ring-1 ring-border/60 transition-all group-hover:scale-110 group-hover:bg-primary/10">
                <item.icon className="h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-primary" />
              </span>
              <span>
                <span className="block text-[9px] font-bold uppercase tracking-[.2em] text-muted-foreground">{item.label}</span>
                <span className="mt-1 block whitespace-nowrap text-sm font-black tabular-nums">{item.value}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <main className="relative z-0 mx-auto max-w-[1450px] space-y-9 p-5 sm:p-7 lg:p-10">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.26em] text-primary">Mission control</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Choose an outcome, not a tool</h2>
          </div>
          <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
            Each mission combines the right data, models and agents. The workspace keeps the context between them.
          </p>
        </div>

        {/* Two editorial columns; each card owns only the height its content needs. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          {missions.map((mission, index) => {
            const MissionIcon = mission.icon;
            const missionLocked = mission.tools.every((tool) => tool.locked);
            return (
              <motion.article
                key={mission.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: index * 0.08, duration: 0.55 }}
                className={`${mission.className} group relative self-start overflow-hidden rounded-[28px] border border-border/60 bg-gradient-to-br ${mission.surface} p-5 sm:p-6`}
              >
                <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-current opacity-[0.025] blur-2xl" />
                <div className="relative flex h-full flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <div className="max-w-md">
                      <p className="text-[9px] font-bold uppercase tracking-[.24em] text-muted-foreground">{mission.eyebrow}</p>
                      <h3 className="mt-2 text-xl font-black leading-tight sm:text-2xl">{mission.title}</h3>
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{mission.description}</p>
                    </div>
                    <motion.span
                      whileHover={{ rotate: 8, scale: 1.08 }}
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/70 shadow-sm backdrop-blur"
                    >
                      <MissionIcon className="h-5 w-5" />
                    </motion.span>
                  </div>

                  <div className={`mt-5 grid gap-1 ${mission.tools.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    {mission.tools.map((tool) => <ToolRow key={tool.path} tool={tool} basePath={basePath} />)}
                  </div>

                  <div className="mt-auto pt-5">
                    <Link
                      href={missionLocked ? `${basePath}/settings` : `${basePath}${mission.href}`}
                      className="inline-flex items-center gap-2 text-xs font-bold"
                    >
                      {missionLocked ? "Connect store to unlock" : mission.action}
                      <motion.span whileHover={{ x: 4 }}><ArrowRight className="h-4 w-4" /></motion.span>
                    </Link>
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>

        <JourneyMap />

        {/* Utility dock: supporting controls stay available without competing with missions. */}
        <section className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <div className="rounded-[28px] border border-border/60 bg-card p-6 text-foreground dark:border-transparent dark:bg-[#101219] dark:text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[.22em] text-muted-foreground dark:text-white/35">Workspace pulse</p>
                <h3 className="mt-1 text-lg font-black">Everything is connected</h3>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/10">
                <StatusPulse />
              </span>
            </div>
            <div className="mt-6 space-y-3">
              {[
                ["Store integration", hasIntegration ? "Connected" : "Action needed"],
                ["AI credit capacity", `${formatCredits(credits.remaining)} left`],
                ["Wallet capacity", wallet ? formatMoney(wallet.balance) : "Unavailable"],
                ["Import intelligence", `${stats?.recentImports ?? 0} sessions`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-border/60 pb-3 text-[10px] dark:border-white/[0.07]">
                  <span className="text-muted-foreground dark:text-white/40">{label}</span>
                  <span className="font-bold text-foreground dark:text-white/85">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card p-6">
            <div className="mb-5">
              <p className="text-[9px] font-bold uppercase tracking-[.22em] text-muted-foreground">Workspace controls</p>
              <h3 className="mt-1 text-lg font-black">Keep the machine running</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { name: "Wallet & costs", note: "Top up and inspect agent spend", icon: CircleDollarSign, path: "/wallet" },
                { name: "Team access", note: "People, roles and permissions", icon: Users, path: permissions.canAdmin ? "/team" : "" },
                { name: "Integrations", note: "Store and workspace settings", icon: Settings, path: permissions.canAdmin ? "/settings" : "" },
                ...(permissions.isOwner ? [{ name: "Subscription", note: "Plan and extra AI credits", icon: Crown, path: "/subscription" }] : []),
              ].map((item) => (
                <Link
                  key={item.name}
                  href={`${basePath}${item.path}`}
                  className="group flex items-center gap-3 rounded-2xl border border-border/60 p-4 hover:border-primary/30 hover:bg-primary/[0.025]"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold">{item.name}</span>
                    <span className="block truncate text-[9px] text-muted-foreground">{item.note}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

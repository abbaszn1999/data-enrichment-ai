"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Package,
  FolderTree,
  Users,
  Loader2,
  ArrowRight,
  FileSpreadsheet,
  BarChart3,
  PieChart,
  TrendingUp,
  Calendar,
} from "lucide-react";
import { useWorkspaceContext } from "./layout";
import { useRole } from "@/hooks/use-role";
import { useCredits } from "@/hooks/use-credits";
import { createClient } from "@/lib/supabase-browser";
import { loadProductsJson, loadCategoriesJson } from "@/lib/storage-helpers";

// ─── Animated Counter Hook ───
function useAnimatedCounter(target: number, duration = 1200) {
  const [count, setCount] = useState(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    const start = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * target));
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return count;
}

// ─── Circular Gauge Component ───
function CreditGauge({ used, total, remaining }: { used: number; total: number; remaining: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const percentage = total > 0 ? Math.min((remaining / total) * 100, 100) : 0;
  const offset = circumference - (percentage / 100) * circumference;
  const animatedRemaining = useAnimatedCounter(remaining, 1600);

  const gaugeColor = percentage > 50 ? "#22c55e" : percentage > 20 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative flex items-center justify-center">
      <svg width="140" height="140" className="-rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="currentColor" strokeWidth="8"
          className="text-muted/40" />
        <circle cx="70" cy="70" r={radius} fill="none" stroke={gaugeColor} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference}
          style={{
            strokeDashoffset: offset,
            transition: "stroke-dashoffset 1.6s cubic-bezier(0.16, 1, 0.3, 1)",
          }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums" style={{ color: gaugeColor }}>
          {animatedRemaining}
        </span>
        <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">
          credits left
        </span>
      </div>
    </div>
  );
}

// ─── Floating Particle Background ───
function ParticleField() {
  const particles = useMemo(() =>
    Array.from({ length: 18 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 2 + Math.random() * 4,
      duration: 4 + Math.random() * 6,
      delay: Math.random() * 4,
      opacity: 0.15 + Math.random() * 0.3,
    })), []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full bg-primary"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            animation: `dash-float ${p.duration}s ease-in-out ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Neural Grid SVG ───
function NeuralGrid() {
  return (
    <svg className="absolute inset-0 w-full h-full opacity-[0.04] dark:opacity-[0.06] pointer-events-none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="neural-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#neural-grid)" />
    </svg>
  );
}

// ─── Live Pulse Dot ───
function PulseDot({ color = "bg-green-500" }: { color?: string }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-75`}
        style={{ animation: "dash-pulse-ring 2s ease-in-out infinite" }} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

// ─── Data Stats ───
interface DashboardStats {
  totalProducts: number;
  totalCategories: number;
  recentImports: number;
  teamMembers: number;
}

export default function WorkspaceDashboardPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace, role, wsLoading } = useWorkspaceContext();
  const permissions = useRole(role);
  const credits = useCredits(workspace?.id ?? null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [creditHistory, setCreditHistory] = useState<{ date: string; credits: number }[]>([]);
  const [operationBreakdown, setOperationBreakdown] = useState<{ operation: string; total: number }[]>([]);
  const [importHistory, setImportHistory] = useState<{ date: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  useEffect(() => {
    if (wsLoading) return;
    if (!workspace) { setLoading(false); return; }

    const supabase = createClient();
    let cancelled = false;

    async function loadStats() {
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

        const [products, categories, sessionsRes, membersRes, txRes, importSessionsRes] = await Promise.all([
          loadProductsJson(workspace!.id),
          loadCategoriesJson(workspace!.id),
          supabase.from("import_sessions").select("id", { count: "exact", head: true }).eq("workspace_id", workspace!.id),
          supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspace!.id),
          supabase.from("credit_transactions").select("credits_used, operation, created_at").eq("workspace_id", workspace!.id).gte("created_at", thirtyDaysAgo.toISOString()).order("created_at", { ascending: true }),
          supabase.from("import_sessions").select("id, created_at").eq("workspace_id", workspace!.id).gte("created_at", thirtyDaysAgo.toISOString()).order("created_at", { ascending: true }),
        ]);

        if (cancelled) return;

        setStats({
          totalProducts: products.length,
          totalCategories: categories.length,
          recentImports: sessionsRes.count ?? 0,
          teamMembers: membersRes.count ?? 0,
        });

        // Build 7-day credit usage chart data
        const txData = txRes.data ?? [];
        const dailyMap = new Map<string, number>();
        for (let i = 0; i < 7; i++) {
          const d = new Date();
          d.setDate(d.getDate() - (6 - i));
          dailyMap.set(d.toISOString().split("T")[0], 0);
        }
        txData.forEach((tx: any) => {
          const day = tx.created_at?.split("T")[0];
          if (day && dailyMap.has(day)) {
            dailyMap.set(day, (dailyMap.get(day) || 0) + (tx.credits_used || 0));
          }
        });
        setCreditHistory(Array.from(dailyMap.entries()).map(([date, credits]) => ({ date, credits })));

        // Build operation breakdown for donut chart
        const opMap = new Map<string, number>();
        txData.forEach((tx: any) => {
          const op = tx.operation || "other";
          opMap.set(op, (opMap.get(op) || 0) + (tx.credits_used || 0));
        });
        setOperationBreakdown(Array.from(opMap.entries()).map(([operation, total]) => ({ operation, total })).sort((a, b) => b.total - a.total).slice(0, 5));

        // Build 30-day import sessions histogram
        const impData = importSessionsRes.data ?? [];
        const weekMap = new Map<string, number>();
        for (let i = 0; i < 4; i++) {
          const wStart = new Date();
          wStart.setDate(wStart.getDate() - (3 - i) * 7);
          const label = wStart.toLocaleDateString([], { month: "short", day: "numeric" });
          weekMap.set(label, 0);
        }
        const weekLabels = Array.from(weekMap.keys());
        impData.forEach((s: any) => {
          const d = new Date(s.created_at);
          const daysAgo = Math.floor((Date.now() - d.getTime()) / 86400000);
          const weekIdx = Math.max(0, 3 - Math.floor(daysAgo / 7));
          if (weekIdx < weekLabels.length) {
            const lbl = weekLabels[weekIdx];
            weekMap.set(lbl, (weekMap.get(lbl) || 0) + 1);
          }
        });
        setImportHistory(Array.from(weekMap.entries()).map(([date, count]) => ({ date, count })));
      } catch (err) {
        console.error("[Dashboard] loadStats error:", err);
      }
      if (!cancelled) setLoading(false);
    }

    loadStats();
    return () => { cancelled = true; };
  }, [workspace, wsLoading]);

  const basePath = `/w/${slug}`;

  const animProducts = useAnimatedCounter(stats?.totalProducts ?? 0);
  const animCategories = useAnimatedCounter(stats?.totalCategories ?? 0);
  const animImports = useAnimatedCounter(stats?.recentImports ?? 0);
  const animMembers = useAnimatedCounter(stats?.teamMembers ?? 0);

  const statCards = [
    {
      label: "Products",
      value: animProducts,
      rawValue: stats?.totalProducts ?? 0,
      icon: Package,
      href: `${basePath}/products`,
      gradient: "from-blue-500/20 via-blue-500/5 to-transparent",
      iconBg: "bg-blue-500/15",
      iconColor: "text-blue-500",
      borderGlow: "hover:shadow-blue-500/10",
      accentColor: "text-blue-500",
    },
    {
      label: "Categories",
      value: animCategories,
      rawValue: stats?.totalCategories ?? 0,
      icon: FolderTree,
      href: `${basePath}/categories`,
      gradient: "from-emerald-500/20 via-emerald-500/5 to-transparent",
      iconBg: "bg-emerald-500/15",
      iconColor: "text-emerald-500",
      borderGlow: "hover:shadow-emerald-500/10",
      accentColor: "text-emerald-500",
    },
    {
      label: "Imports",
      value: animImports,
      rawValue: stats?.recentImports ?? 0,
      icon: FileSpreadsheet,
      href: `${basePath}/import`,
      gradient: "from-violet-500/20 via-violet-500/5 to-transparent",
      iconBg: "bg-violet-500/15",
      iconColor: "text-violet-500",
      borderGlow: "hover:shadow-violet-500/10",
      accentColor: "text-violet-500",
    },
    {
      label: "Team",
      value: animMembers,
      rawValue: stats?.teamMembers ?? 0,
      icon: Users,
      href: permissions.canAdmin ? `${basePath}/team` : basePath,
      gradient: "from-amber-500/20 via-amber-500/5 to-transparent",
      iconBg: "bg-amber-500/15",
      iconColor: "text-amber-500",
      borderGlow: "hover:shadow-amber-500/10",
      accentColor: "text-amber-500",
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="absolute inset-0 h-6 w-6 rounded-full"
              style={{ animation: "dash-pulse-ring 2s ease-in-out infinite", border: "2px solid var(--primary)" }} />
          </div>
          <span className="text-xs text-muted-foreground">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full">
      <NeuralGrid />
      <ParticleField />

      <div className="relative z-10 p-6 space-y-6 max-w-[1400px] mx-auto">

        {/* ═══ Hero Header ═══ */}
        <div className="dash-animate-in relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-background via-background to-muted/30 p-6 md:p-8">
          <div className="absolute top-0 right-0 w-72 h-72 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none"
            style={{ animation: "dash-glow 6s ease-in-out infinite" }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-violet-500/5 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none"
            style={{ animation: "dash-glow 8s ease-in-out 2s infinite" }} />

          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <PulseDot color="bg-emerald-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">System Online</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                {greeting}, <span className="bg-gradient-to-r from-primary via-violet-500 to-primary bg-[length:200%_auto] bg-clip-text text-transparent"
                  style={{ animation: "dash-gradient-shift 4s linear infinite" }}>
                  {workspace?.name}
                </span>
              </h1>
              <p className="text-sm text-muted-foreground max-w-md">
                Your AI-powered data enrichment workspace. Monitor your data pipeline, track AI credit usage, and manage your team.
              </p>
            </div>

            {/* Credit Gauge */}
            <div className="flex items-center gap-5 shrink-0">
              <CreditGauge used={credits.used} total={credits.total} remaining={credits.remaining} />
              <div className="space-y-1.5 hidden sm:block">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">AI Credits</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-black tabular-nums">{credits.used}</span>
                  <span className="text-xs text-muted-foreground">/ {credits.total} used</span>
                </div>
                <div className="w-32 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-1000 ease-out"
                    style={{
                      width: `${credits.total > 0 ? Math.min((credits.used / credits.total) * 100, 100) : 0}%`,
                      background: credits.remaining > credits.total * 0.5 ? "linear-gradient(90deg, #22c55e, #4ade80)"
                        : credits.remaining > credits.total * 0.2 ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                        : "linear-gradient(90deg, #ef4444, #f87171)",
                    }} />
                </div>
                <Link href={`${basePath}/usage`} className="text-[10px] text-primary hover:underline underline-offset-2 font-medium flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" /> View usage details
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ Stat Cards ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat, i) => (
            <Link key={stat.label} href={stat.href}>
              <div className={`dash-animate-in dash-delay-${i + 1} group relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5 cursor-pointer transition-all duration-300 hover:border-border hover:shadow-lg ${stat.borderGlow} hover:-translate-y-0.5`}>
                <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                <div className="relative">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`h-10 w-10 rounded-xl ${stat.iconBg} flex items-center justify-center transition-transform duration-300 group-hover:scale-110`}>
                      <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-muted-foreground transition-all duration-300 group-hover:translate-x-0 -translate-x-2" />
                  </div>
                  <div className={`text-3xl font-black tabular-nums ${stat.accentColor}`}
                    style={{ animation: "dash-counter 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards" }}>
                    {stat.value}
                  </div>
                  <div className="text-[11px] font-semibold text-muted-foreground mt-1 uppercase tracking-wider">
                    {stat.label}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* ═══ Charts Section ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Area Chart: AI Credit Usage (7 Days) ── */}
          <div className="dash-animate-in dash-delay-5 lg:col-span-2 relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5">
            <div className="absolute top-0 right-0 w-60 h-60 bg-violet-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4 text-violet-500" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold">AI Credit Usage</h2>
                    <p className="text-[9px] text-muted-foreground">Last 7 days</p>
                  </div>
                </div>
                <Link href={`${basePath}/usage`} className="text-[10px] text-primary hover:underline underline-offset-2 font-medium flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" /> Details
                </Link>
              </div>

              {(() => {
                const data = creditHistory;
                const maxVal = Math.max(...data.map(d => d.credits), 1);
                const W = 100;
                const H = 40;
                const padY = 2;
                const usableH = H - padY * 2;

                const points = data.map((d, i) => {
                  const x = data.length > 1 ? (i / (data.length - 1)) * W : W / 2;
                  const y = padY + usableH - (d.credits / maxVal) * usableH;
                  return { x, y, ...d };
                });

                const linePath = points.map((p, i) => {
                  if (i === 0) return `M ${p.x} ${p.y}`;
                  const prev = points[i - 1];
                  const cpx1 = prev.x + (p.x - prev.x) * 0.4;
                  const cpx2 = prev.x + (p.x - prev.x) * 0.6;
                  return `C ${cpx1} ${prev.y}, ${cpx2} ${p.y}, ${p.x} ${p.y}`;
                }).join(" ");

                const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? W} ${H} L ${points[0]?.x ?? 0} ${H} Z`;
                const totalCredits = data.reduce((s, d) => s + d.credits, 0);

                return (
                  <div>
                    <div className="flex items-baseline gap-2 mb-3">
                      <span className="text-2xl font-black tabular-nums">{totalCredits}</span>
                      <span className="text-[10px] text-muted-foreground">credits used this week</span>
                    </div>
                    <div className="relative">
                      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
                          <line key={pct} x1="0" y1={padY + usableH * (1 - pct)} x2={W} y2={padY + usableH * (1 - pct)}
                            stroke="currentColor" strokeWidth="0.15" className="text-border" strokeDasharray="1 1" />
                        ))}
                        <path d={areaPath} fill="url(#areaGrad)" />
                        <path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth="0.6" strokeLinecap="round" />
                        {points.map((p, i) => (
                          <circle key={i} cx={p.x} cy={p.y} r="0.8" fill="#8b5cf6" stroke="var(--card)" strokeWidth="0.4">
                            <title>{p.date}: {p.credits} credits</title>
                          </circle>
                        ))}
                      </svg>
                      <div className="flex justify-between mt-2">
                        {data.map((d, i) => (
                          <span key={i} className="text-[8px] text-muted-foreground/60 tabular-nums">
                            {new Date(d.date).toLocaleDateString([], { weekday: "short" })}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Donut Chart: Credit Breakdown by Operation ── */}
          <div className="dash-animate-in dash-delay-6 relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                <PieChart className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <h2 className="text-sm font-bold">Credit Breakdown</h2>
                <p className="text-[9px] text-muted-foreground">By operation type</p>
              </div>
            </div>

            {(() => {
              const data = operationBreakdown;
              const total = data.reduce((s, d) => s + d.total, 0);
              const colors = ["#8b5cf6", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];
              const opLabels: Record<string, string> = {
                enrichment: "Enrichment",
                ai_function: "AI Functions",
                matching: "Matching",
                web_search: "Web Search",
                other: "Other",
              };

              if (total === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeWidth="12" className="text-muted/30" />
                    </svg>
                    <p className="text-[10px] text-muted-foreground">No credit usage yet</p>
                  </div>
                );
              }

              let cumAngle = -90;
              const slices = data.map((d, i) => {
                const angle = (d.total / total) * 360;
                const startAngle = cumAngle;
                cumAngle += angle;
                const r = 48;
                const cx = 60, cy = 60;
                const rad1 = (startAngle * Math.PI) / 180;
                const rad2 = ((startAngle + angle) * Math.PI) / 180;
                const x1 = cx + r * Math.cos(rad1);
                const y1 = cy + r * Math.sin(rad1);
                const x2 = cx + r * Math.cos(rad2);
                const y2 = cy + r * Math.sin(rad2);
                const largeArc = angle > 180 ? 1 : 0;
                const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                return { path, color: colors[i % colors.length], ...d };
              });

              return (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <svg width="140" height="140" viewBox="0 0 120 120">
                      {slices.map((s, i) => (
                        <path key={i} d={s.path} fill={s.color} opacity="0.85" className="transition-opacity hover:opacity-100">
                          <title>{opLabels[s.operation] || s.operation}: {s.total} credits</title>
                        </path>
                      ))}
                      <circle cx="60" cy="60" r="28" className="fill-card" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-black tabular-nums">{total}</span>
                      <span className="text-[8px] text-muted-foreground uppercase tracking-wider">Total</span>
                    </div>
                  </div>
                  <div className="w-full space-y-1.5">
                    {slices.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="flex-1 text-muted-foreground truncate">{opLabels[s.operation] || s.operation}</span>
                        <span className="font-bold tabular-nums">{s.total}</span>
                        <span className="text-muted-foreground/60 w-8 text-right">{Math.round((s.total / total) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── Bar Chart: Import Activity (Last 4 Weeks) ── */}
        <div className="dash-animate-in dash-delay-7 relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5">
          <div className="absolute bottom-0 left-0 w-60 h-40 bg-emerald-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/4 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                  <Calendar className="h-4 w-4 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-sm font-bold">Import Activity</h2>
                  <p className="text-[9px] text-muted-foreground">Sessions per week — last 4 weeks</p>
                </div>
              </div>
              <Link href={`${basePath}/import`} className="text-[10px] text-primary hover:underline underline-offset-2 font-medium flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" /> View all
              </Link>
            </div>

            {(() => {
              const data = importHistory;
              const maxVal = Math.max(...data.map(d => d.count), 1);
              const totalImports = data.reduce((s, d) => s + d.count, 0);

              return (
                <div>
                  <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-2xl font-black tabular-nums">{totalImports}</span>
                    <span className="text-[10px] text-muted-foreground">imports this month</span>
                  </div>
                  <div className="flex items-end gap-3 h-32">
                    {data.map((d, i) => {
                      const heightPct = maxVal > 0 ? (d.count / maxVal) * 100 : 0;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-2">
                          <span className="text-[10px] font-bold tabular-nums text-emerald-500">{d.count}</span>
                          <div className="w-full rounded-t-lg relative overflow-hidden" style={{ height: `${Math.max(heightPct, 4)}%` }}>
                            <div className="absolute inset-0 bg-gradient-to-t from-emerald-500 to-emerald-400 opacity-80 hover:opacity-100 transition-opacity rounded-t-lg"
                              style={{
                                animation: `dash-slide-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${0.3 + i * 0.1}s forwards`,
                                opacity: 0,
                              }} />
                          </div>
                          <span className="text-[8px] text-muted-foreground/60 whitespace-nowrap">{d.date}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

      </div>
    </div>
  );
}

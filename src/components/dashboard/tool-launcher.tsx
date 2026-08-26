"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useMotionTemplate,
  useSpring,
} from "motion/react";
import {
  ArrowUpRight,
  Command,
  Lock,
  Search as SearchIcon,
  Sparkles,
  X,
} from "lucide-react";
import {
  BILLING_LABEL,
  CATEGORY_STYLE,
  TOOL_CATEGORIES,
  matchesQuery,
  visibleTools,
  type ToolCategory,
  type ToolDefinition,
} from "./tools-catalog";

/** A single tool card. The spotlight follows the cursor, which is what makes
 *  the grid feel alive without animating anything on a timer. */
function ToolCard({
  tool,
  basePath,
  locked,
  index,
}: {
  tool: ToolDefinition;
  basePath: string;
  locked: boolean;
  index: number;
}) {
  const style = CATEGORY_STYLE[tool.category];
  const cardRef = useRef<HTMLDivElement>(null);
  const rawX = useMotionValue(50);
  const rawY = useMotionValue(50);
  const x = useSpring(rawX, { stiffness: 220, damping: 30 });
  const y = useSpring(rawY, { stiffness: 220, damping: 30 });
  const [hovered, setHovered] = useState(false);
  const spotlight = useMotionTemplate`radial-gradient(320px circle at ${x}% ${y}%, ${style.glow}, transparent 65%)`;

  const handleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    rawX.set(((event.clientX - rect.left) / rect.width) * 100);
    rawY.set(((event.clientY - rect.top) / rect.height) * 100);
  };

  const Icon = tool.icon;
  const href = locked ? `${basePath}/settings` : `${basePath}${tool.path}`;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{
        duration: 0.35,
        delay: Math.min(index * 0.035, 0.35),
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <Link href={href} className="block h-full">
        <motion.div
          ref={cardRef}
          onPointerMove={handleMove}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          whileHover={{ y: -4 }}
          whileTap={{ scale: 0.985 }}
          transition={{ type: "spring", stiffness: 320, damping: 24 }}
          className={`group relative h-full overflow-hidden rounded-2xl border bg-card p-4 ${
            locked ? "border-border/40" : "border-border/60"
          } hover:border-border hover:shadow-xl hover:shadow-black/[0.04]`}
        >
          {/* Cursor spotlight */}
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{ background: spotlight }}
          />
          {/* Top hairline that lights up on hover */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${style.text}`}
            style={{ backgroundImage: "linear-gradient(90deg, transparent, currentColor, transparent)" }}
          />

          <div className="relative flex h-full flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <motion.div
                animate={hovered ? { scale: 1.08, rotate: -3 } : { scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 18 }}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${style.bg} ${style.ring}`}
              >
                <Icon className={`h-5 w-5 ${style.text}`} />
              </motion.div>

              <div className="flex items-center gap-1.5">
                {tool.model && (
                  <span className="hidden rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] font-medium text-muted-foreground sm:inline">
                    {tool.model}
                  </span>
                )}
                <motion.span
                  animate={hovered ? { x: 2, y: -2, opacity: 1 } : { x: -2, y: 2, opacity: 0.25 }}
                  transition={{ type: "spring", stiffness: 320, damping: 22 }}
                  className="text-muted-foreground"
                >
                  <ArrowUpRight className="h-4 w-4" />
                </motion.span>
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="text-sm font-bold leading-tight">{tool.name}</h3>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{tool.blurb}</p>
            </div>

            <div className="mt-auto flex items-center gap-2 pt-1">
              {locked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  <Lock className="h-2.5 w-2.5" /> Connect a store
                </span>
              ) : (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${style.bg} ${style.text}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  Ready
                </span>
              )}
              <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                {BILLING_LABEL[tool.billing]}
              </span>
            </div>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}

export function ToolLauncher({
  basePath,
  hasIntegration,
  canAdmin,
  isOwner,
}: {
  basePath: string;
  hasIntegration: boolean;
  canAdmin: boolean;
  isOwner: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ToolCategory | "all">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  const allTools = useMemo(() => visibleTools({ canAdmin, isOwner }), [canAdmin, isOwner]);

  const results = useMemo(
    () =>
      allTools.filter(
        (tool) =>
          (category === "all" || tool.category === category) && matchesQuery(tool, query)
      ),
    [allTools, category, query]
  );

  // ⌘K / Ctrl+K focuses the launcher, Escape clears it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        setQuery("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const countsByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const tool of allTools) {
      map.set(tool.category, (map.get(tool.category) ?? 0) + 1);
    }
    map.set("all", allTools.length);
    return map;
  }, [allTools]);

  return (
    <section className="space-y-4">
      {/* Header + search */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold leading-tight">Your AI toolkit</h2>
            <p className="text-[10px] text-muted-foreground">
              {allTools.length} tools · {results.length} shown
            </p>
          </div>
        </div>

        <div className="relative w-full md:w-80">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools — try “images” or “seo”"
            className="h-9 w-full rounded-xl border border-border/60 bg-card pl-9 pr-16 text-xs outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <AnimatePresence initial={false}>
              {query && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => setQuery("")}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </motion.button>
              )}
            </AnimatePresence>
            {!query && (
              <span className="hidden items-center gap-0.5 rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground sm:flex">
                <Command className="h-2.5 w-2.5" />K
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Category chips with a sliding active pill */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOL_CATEGORIES.map((chip) => {
          const active = category === chip.id;
          const count = countsByCategory.get(chip.id) ?? 0;
          if (count === 0) return null;
          return (
            <button
              key={chip.id}
              onClick={() => setCategory(chip.id)}
              className={`relative rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="tool-filter-pill"
                  className="absolute inset-0 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 480, damping: 34 }}
                />
              )}
              <span className="relative z-10">
                {chip.label}
                <span className={active ? "opacity-70" : "opacity-50"}> · {count}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <motion.div layout className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {results.map((tool, index) => (
            <ToolCard
              key={tool.path}
              tool={tool}
              basePath={basePath}
              locked={!!tool.needsIntegration && !hasIntegration}
              index={index}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      {results.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-dashed border-border/60 py-10 text-center"
        >
          <p className="text-sm font-semibold">No tool matches “{query}”</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a broader word, or clear the filter to see everything.
          </p>
        </motion.div>
      )}
    </section>
  );
}

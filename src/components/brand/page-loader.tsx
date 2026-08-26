import Image from "next/image";
import { AUTOMMERCE_COLORS, AUTOMMERCE_LOGOS } from "@/lib/brand/tokens";
import { cn } from "@/lib/utils";

const ORBIT_DOTS = [
  { color: AUTOMMERCE_COLORS.primary.orange, rotate: "0deg" },
  { color: AUTOMMERCE_COLORS.primary.red, rotate: "120deg" },
  { color: AUTOMMERCE_COLORS.primary.purple, rotate: "240deg" },
] as const;

type PageLoaderProps = {
  label?: string;
  className?: string;
  size?: "sm" | "md";
};

/**
 * Inner-content page loader: colored Autommerce mark stays still,
 * brand-color satellites orbit it. Use for route/page waits only —
 * keep small button spinners as they are.
 */
export function PageLoader({
  label,
  className,
  size = "md",
}: PageLoaderProps) {
  const logoSize = size === "sm" ? 28 : 40;
  const frame = size === "sm" ? 72 : 96;
  const radius = size === "sm" ? 30 : 40;
  const dot = size === "sm" ? 7 : 8;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex h-full min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 bg-background [font-family:var(--brand-font)]",
        className
      )}
    >
      <div
        className="relative"
        style={{ width: frame, height: frame }}
      >
        <div
          className="pointer-events-none absolute rounded-full border border-border/70"
          style={{ inset: size === "sm" ? 8 : 10 }}
        />
        <div
          className="absolute inset-0 animate-spin motion-reduce:animate-none"
          style={{ animationDuration: "1.85s" }}
        >
          {ORBIT_DOTS.map((item) => (
            <span
              key={item.color}
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: dot,
                height: dot,
                marginLeft: -dot / 2,
                marginTop: -dot / 2,
                backgroundColor: item.color,
                boxShadow: `0 0 10px ${item.color}99`,
                transform: `rotate(${item.rotate}) translateY(-${radius}px)`,
              }}
            />
          ))}
        </div>
        <Image
          src={AUTOMMERCE_LOGOS.light}
          alt=""
          width={logoSize}
          height={logoSize}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain"
          priority
        />
      </div>
      {label ? (
        <p className="text-xs text-muted-foreground">{label}</p>
      ) : null}
      <span className="sr-only">{label || "Loading"}</span>
    </div>
  );
}

import Image from "next/image";
import { AUTOMMERCE_LOGOS } from "@/lib/brand/tokens";

type AutommerceLogoProps = {
  size?: number;
  priority?: boolean;
  className?: string;
};

/**
 * Theme-aware Autommerce symbol.
 * Natural colour mark on light surfaces, white mark on dark surfaces.
 */
export function AutommerceLogo({
  size = 30,
  priority = false,
  className = "",
}: AutommerceLogoProps) {
  return (
    <span
      className={`relative block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-label="Autommerce"
    >
      <Image
        src={AUTOMMERCE_LOGOS.light}
        alt=""
        fill
        sizes={`${size}px`}
        className="object-contain dark:hidden"
        priority={priority}
      />
      <Image
        src={AUTOMMERCE_LOGOS.dark}
        alt=""
        fill
        sizes={`${size}px`}
        className="hidden object-contain dark:block"
        priority={priority}
      />
    </span>
  );
}


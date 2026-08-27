import Link from "next/link";
import { initials } from "@/lib/platform-admin/format";

export function PersonCell({
  name,
  email,
  href,
}: {
  name: string;
  email?: string;
  href?: string;
}) {
  const body = (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#400095]/10 text-[11px] font-semibold text-[#400095] ring-1 ring-[#400095]/10 dark:bg-[#F76D01]/15 dark:text-[#F76D01] dark:ring-[#F76D01]/20">
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium leading-tight">{name}</span>
        {email ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{email}</span>
        ) : null}
      </span>
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} className="hover:opacity-90" onClick={(event) => event.stopPropagation()}>
      {body}
    </Link>
  );
}

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
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#400095]/10 text-[10px] font-semibold text-[#400095] dark:bg-[#F76D01]/15 dark:text-[#F76D01]">
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        {email ? <span className="block truncate text-xs text-muted-foreground">{email}</span> : null}
      </span>
    </div>
  );
  if (!href) return body;
  return (
    <Link href={href} className="hover:opacity-80" onClick={(event) => event.stopPropagation()}>
      {body}
    </Link>
  );
}

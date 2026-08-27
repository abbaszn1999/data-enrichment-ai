"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { adminJson } from "@/lib/platform-admin/client-api";
import { adminRoutes } from "@/lib/platform-admin/paths";
import type { LiveUserListRow, LiveWorkspaceListRow } from "@/lib/platform-admin/live-types";

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<LiveUserListRow[]>([]);
  const [workspaces, setWorkspaces] = useState<LiveWorkspaceListRow[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const hasHits = users.length > 0 || workspaces.length > 0;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setUsers([]);
      setWorkspaces([]);
      return;
    }
    const handle = window.setTimeout(() => {
      adminJson<{ users: LiveUserListRow[]; workspaces: LiveWorkspaceListRow[] }>(
        `/api/platform-admin/search?q=${encodeURIComponent(q)}`
      )
        .then((data) => {
          setUsers(data.users);
          setWorkspaces(data.workspaces);
        })
        .catch(() => {
          setUsers([]);
          setWorkspaces([]);
        });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const go = (href: string) => {
    setQuery("");
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search live users or workspaces"
        className="h-8 pl-8 text-xs"
      />
      {open && query.trim() ? (
        <div className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-lg border bg-popover py-1 shadow-lg">
          {!hasHits ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
          ) : (
            <>
              {users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-muted"
                  onClick={() => go(adminRoutes.user(user.id))}
                >
                  <span className="text-xs font-medium">{user.fullName}</span>
                  <span className="text-[11px] text-muted-foreground">{user.email}</span>
                </button>
              ))}
              {workspaces.map((workspace) => (
                <Link
                  key={workspace.id}
                  href={adminRoutes.workspace(workspace.id)}
                  className="flex w-full flex-col px-3 py-2 hover:bg-muted"
                  onClick={() => {
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="text-xs font-medium">{workspace.name}</span>
                  <span className="text-[11px] text-muted-foreground">/{workspace.slug}</span>
                </Link>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

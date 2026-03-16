"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Plus,
  Users,
  Package,
  FolderTree,
  Clock,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockWorkspaces } from "../mock-data";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const days = Math.floor((now - then) / 86400000);
  if (days < 1) return "Today";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export default function DemoWorkspacesPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your Workspaces</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{mockWorkspaces.length} workspaces</p>
        </div>
        <Button className="gap-1.5 text-xs" onClick={() => router.push("/demo/workspaces/new")}>
          <Plus className="h-3.5 w-3.5" /> Create Workspace
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {mockWorkspaces.map((ws) => (
          <Card
            key={ws.id}
            className="p-5 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group"
            onClick={() => router.push("/demo/dashboard")}
          >
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold">{ws.name}</h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">{ws.description}</p>

                <div className="flex items-center gap-3 mt-3">
                  <Badge variant="secondary" className="text-[9px] gap-1">
                    <Package className="h-2.5 w-2.5" /> {ws.productCount} products
                  </Badge>
                  <Badge variant="secondary" className="text-[9px] gap-1">
                    <FolderTree className="h-2.5 w-2.5" /> {ws.categoryCount} categories
                  </Badge>
                  <Badge variant="secondary" className="text-[9px] gap-1">
                    <Users className="h-2.5 w-2.5" /> {ws.memberCount} members
                  </Badge>
                </div>

                <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-2">
                  <Clock className="h-2.5 w-2.5" />
                  Created {timeAgo(ws.createdAt)}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

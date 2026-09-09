"use client";

import {
  Bot,
  User as UserIcon,
  Store,
  Send,
  Globe,
  Zap,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MESSAGES = [
  {
    role: "user" as const,
    content: "Load draft products missing descriptions and write SEO titles for the Samsung batch",
  },
  {
    role: "assistant" as const,
    content:
      "Found **48 draft products** in your Shopify store. I'll write SEO-optimized titles and descriptions for rows missing content.\n\nStarting with Samsung Galaxy line…",
  },
  {
    role: "assistant" as const,
    content: "✓ Updated 48 products — titles, descriptions, and meta fields synced to Shopify.",
  },
];

const PRODUCTS = [
  { title: "Samsung Galaxy S24 Ultra 512GB — Titanium Gray", status: "Updated", price: "$1,199" },
  { title: "Samsung Galaxy Buds3 Pro — Active Noise Cancellation", status: "Updated", price: "$249" },
  { title: "Dell UltraSharp 27\" 4K USB-C Hub Monitor", status: "Updated", price: "$549" },
  { title: "Sony WH-1000XM5 — Industry-Leading Noise Cancellation", status: "Updated", price: "$399" },
  { title: "Apple AirPods 4 — Spatial Audio, USB-C", status: "Updated", price: "$179" },
  { title: "Nike Air Max 90 — Men's Running Shoes", status: "Updated", price: "$130" },
];

export default function DemoSyncPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-hidden bg-background">
      <div className="border-b px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Sync</span>
          <Badge variant="outline" className="text-[10px]">Shopify</Badge>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-green-600" />
          TechStore Electronics · Connected
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Chat */}
        <div className="w-[460px] border-r flex flex-col min-h-0 bg-background shrink-0">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {MESSAGES.map((msg, i) => (
              <div key={i} className="flex gap-3">
                <div
                  className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                    msg.role === "user" ? "bg-primary/10" : "bg-muted"
                  }`}
                >
                  {msg.role === "user" ? (
                    <UserIcon className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-muted-foreground mb-1">
                    {msg.role === "user" ? "You" : "Sync AI"}
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t p-3 space-y-2 shrink-0">
            <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Describe what you want to do…
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary">
                <Globe className="h-3.5 w-3.5" /> Web
              </button>
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-background shadow-sm">
                <Zap className="h-3 w-3" /> Fast
              </button>
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground">
                <Sparkles className="h-3 w-3" /> Pro
              </button>
              <div className="flex-1" />
              <button className="h-9 w-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Store sheet */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="border-b px-4 py-2.5 flex items-center justify-between shrink-0">
            <span className="text-sm font-semibold">Store products</span>
            <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">
              48 updated
            </Badge>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Product</TableHead>
                  <TableHead className="text-xs w-24">Price</TableHead>
                  <TableHead className="text-xs w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PRODUCTS.map((p) => (
                  <TableRow key={p.title}>
                    <TableCell className="text-xs font-medium">{p.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.price}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px] text-green-700 border-green-200 bg-green-50">
                        {p.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}

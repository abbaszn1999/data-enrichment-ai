"use client";

import Link from "next/link";
import {
  ArrowRight,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  Download,
  MapPin,
  Settings2,
  Eye,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function DemoImportSessionPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Samsung Q3 Shipment</h1>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
            <span>Supplier: Samsung Electronics</span>
            <span>|</span>
            <span>Created: June 10, 2025</span>
            <span>|</span>
            <span>By: Ahmed Al-Rashid</span>
          </div>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs">
          <Download className="h-3.5 w-3.5" /> Download Original
        </Button>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold">8</div>
          <div className="text-[10px] text-muted-foreground">Total Rows</div>
        </Card>
        <Card className="p-4 text-center bg-green-50/30 dark:bg-green-950/10 border-green-200">
          <div className="text-2xl font-bold text-green-700 dark:text-green-400">4</div>
          <div className="text-[10px] text-green-600">Existing (Update)</div>
        </Card>
        <Card className="p-4 text-center bg-blue-50/30 dark:bg-blue-950/10 border-blue-200">
          <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">4</div>
          <div className="text-[10px] text-blue-600">New Products</div>
        </Card>
        <Card className="p-4 text-center bg-purple-50/30 dark:bg-purple-950/10 border-purple-200">
          <div className="text-2xl font-bold text-purple-700 dark:text-purple-400">4</div>
          <div className="text-[10px] text-purple-600">AI Enriched</div>
        </Card>
      </div>

      {/* Workflow Steps */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-4">Workflow Progress</h2>
        <div className="space-y-3">
          {[
            {
              step: 1,
              label: "Column Mapping",
              desc: "6 of 6 supplier columns mapped to system fields",
              status: "completed",
              icon: MapPin,
              href: "/demo/import/session/mapping",
            },
            {
              step: 2,
              label: "Matching Rules",
              desc: "3 rules enabled: Trim, Case-insensitive, Ignore prefix '00'",
              status: "completed",
              icon: Settings2,
              href: "/demo/import/session/rules",
            },
            {
              step: 3,
              label: "Review Results",
              desc: "4 existing products updated, 4 new products identified",
              status: "completed",
              icon: Eye,
              href: "/demo/import/session/review",
            },
            {
              step: 4,
              label: "AI Enrichment",
              desc: "4 new products enriched with AI-generated content",
              status: "completed",
              icon: Sparkles,
              href: "/demo/import/session/enrich",
            },
          ].map((item) => (
            <Link key={item.step} href={item.href}>
              <div className="flex items-center gap-4 p-3 rounded-lg border hover:border-primary/40 hover:bg-muted/30 transition-all cursor-pointer group">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                  item.status === "completed"
                    ? "bg-green-100 dark:bg-green-900/30"
                    : item.status === "current"
                    ? "bg-primary/10"
                    : "bg-muted"
                }`}>
                  {item.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <span className="text-xs font-bold text-muted-foreground">{item.step}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground">{item.desc}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </Link>
          ))}
        </div>
      </Card>

      {/* File Info */}
      <Card className="p-4">
        <h3 className="text-xs font-semibold mb-3 flex items-center gap-2">
          <FileSpreadsheet className="h-3.5 w-3.5" /> Source File
        </h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[10px]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">File Name</span>
            <span className="font-medium">samsung_q3_shipment.xlsx</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">File Size</span>
            <span className="font-medium">245 KB</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Columns</span>
            <span className="font-medium">6</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Rows</span>
            <span className="font-medium">8</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Uploaded</span>
            <span className="font-medium">June 10, 2025</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Stored In</span>
            <span className="font-medium font-mono">supplier/samsung_q3_*.xlsx</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

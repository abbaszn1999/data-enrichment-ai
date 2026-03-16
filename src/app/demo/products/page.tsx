"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Search,
  Upload,
  Download,
  MoreVertical,
  Filter,
  Package,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Archive,
  Trash2,
  Eye,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mockMasterProducts, mockCategories } from "../mock-data";

const flatCategories = ["All Categories", "Laptops", "Gaming Laptops", "Business Laptops", "Smartphones", "Android Phones", "iPhones", "Tablets", "Cases & Covers", "Chargers & Cables", "Audio", "Hair Care", "Skincare"];

export default function DemoProductsPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All Categories");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pageSize, setPageSize] = useState(25);

  const filtered = mockMasterProducts.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter !== "All Categories" && p.category !== categoryFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5" /> Master Products
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{mockMasterProducts.length} products in catalog</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Link href="/demo/products/upload">
            <Button size="sm" className="gap-1.5 text-xs">
              <Upload className="h-3.5 w-3.5" /> Upload Products
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search by SKU or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-4 text-xs rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-9 rounded-lg border bg-background text-xs px-3 outline-none focus:ring-2 focus:ring-primary/50"
        >
          {flatCategories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-lg border bg-background text-xs px-3 outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-2.5 font-semibold w-8">
                  <input type="checkbox" className="rounded" />
                </th>
                <th className="text-left px-4 py-2.5 font-semibold">SKU</th>
                <th className="text-left px-4 py-2.5 font-semibold">Product Name</th>
                <th className="text-left px-4 py-2.5 font-semibold">Category</th>
                <th className="text-left px-4 py-2.5 font-semibold">Brand</th>
                <th className="text-right px-4 py-2.5 font-semibold">Price</th>
                <th className="text-right px-4 py-2.5 font-semibold">Stock</th>
                <th className="text-center px-4 py-2.5 font-semibold">Status</th>
                <th className="text-center px-4 py-2.5 font-semibold w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <input type="checkbox" className="rounded" />
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground">{product.sku}</td>
                  <td className="px-4 py-3 font-medium">{product.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-[9px]">{product.category}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{product.brand}</td>
                  <td className="px-4 py-3 text-right font-mono">${product.price}</td>
                  <td className="px-4 py-3 text-right font-mono">{product.stock}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge
                      variant="secondary"
                      className={`text-[9px] ${
                        product.status === "active"
                          ? "bg-green-50 dark:bg-green-950/30 text-green-700"
                          : "bg-gray-50 dark:bg-gray-950/30 text-gray-500"
                      }`}
                    >
                      {product.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded hover:bg-muted">
                          <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-xs gap-2"><Eye className="h-3 w-3" /> View Details</DropdownMenuItem>
                        <DropdownMenuItem className="text-xs gap-2"><Pencil className="h-3 w-3" /> Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-xs gap-2"><Archive className="h-3 w-3" /> Archive</DropdownMenuItem>
                        <DropdownMenuItem className="text-xs gap-2 text-destructive"><Trash2 className="h-3 w-3" /> Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t bg-muted/20">
          <span className="text-[10px] text-muted-foreground">
            Showing <span className="font-semibold text-foreground">1-{filtered.length}</span> of <span className="font-semibold text-foreground">{filtered.length}</span> products
          </span>
          <div className="flex items-center gap-1">
            <button className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30" disabled><ChevronsLeft className="h-3.5 w-3.5" /></button>
            <button className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30" disabled><ChevronLeft className="h-3.5 w-3.5" /></button>
            <button className="h-6 min-w-[24px] px-1 flex items-center justify-center rounded text-[10px] font-medium bg-primary text-primary-foreground shadow-sm">1</button>
            <button className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30" disabled><ChevronRight className="h-3.5 w-3.5" /></button>
            <button className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30" disabled><ChevronsRight className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-6 rounded border bg-background text-[10px] font-medium px-1 outline-none">
              {[25, 50, 100, 250].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </Card>
    </div>
  );
}

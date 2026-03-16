"use client";

import { useState } from "react";
import {
  FolderTree,
  ChevronRight,
  ChevronDown,
  Plus,
  Upload,
  Pencil,
  Trash2,
  Package,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockCategories } from "../mock-data";

type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  productCount: number;
  children: CategoryNode[];
};

function CategoryTreeItem({ node, level = 0 }: { node: CategoryNode; level?: number }) {
  const [expanded, setExpanded] = useState(level === 0);
  const [selected, setSelected] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer transition-colors group ${
          selected ? "bg-primary/10 text-primary" : "hover:bg-muted"
        }`}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={() => setSelected(!selected)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted shrink-0"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <div className="w-5" />
        )}

        <FolderTree className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium flex-1 truncate">{node.name}</span>
        <Badge variant="secondary" className="text-[9px] font-mono gap-1 opacity-70">
          <Package className="h-2.5 w-2.5" />
          {node.productCount}
        </Badge>
        <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
          <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-primary/10 text-muted-foreground hover:text-primary" title="Add child">
            <Plus className="h-3 w-3" />
          </button>
          <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-primary/10 text-muted-foreground hover:text-primary" title="Edit">
            <Pencil className="h-3 w-3" />
          </button>
          <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <CategoryTreeItem key={child.id} node={child} level={level + 1} />
        ))}
    </div>
  );
}

export default function DemoCategoriesPage() {
  const [showAddDialog, setShowAddDialog] = useState(false);

  const totalProducts = mockCategories.reduce(
    (sum, c) => sum + c.productCount,
    0
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FolderTree className="h-5 w-5" /> Categories
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mockCategories.length} root categories, {totalProducts} total products
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
          >
            <Upload className="h-3.5 w-3.5" /> Upload CSV
          </Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => setShowAddDialog(true)}
          >
            <Plus className="h-3.5 w-3.5" /> Add Category
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tree View */}
        <div className="lg:col-span-2">
          <Card className="p-3">
            <div className="space-y-0.5">
              {mockCategories.map((cat) => (
                <CategoryTreeItem key={cat.id} node={cat as CategoryNode} />
              ))}
            </div>
          </Card>
        </div>

        {/* Details Panel */}
        <div>
          <Card className="p-4 space-y-4">
            <h3 className="text-sm font-semibold">Category Details</h3>
            <p className="text-xs text-muted-foreground">
              Click a category to view and edit its details.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Name
                </label>
                <input
                  type="text"
                  value="Electronics"
                  readOnly
                  className="w-full h-8 px-2.5 text-xs rounded border bg-muted/50 mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Slug
                </label>
                <input
                  type="text"
                  value="electronics"
                  readOnly
                  className="w-full h-8 px-2.5 text-xs rounded border bg-muted/50 mt-1 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Parent
                </label>
                <input
                  type="text"
                  value="None (Root)"
                  readOnly
                  className="w-full h-8 px-2.5 text-xs rounded border bg-muted/50 mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Description
                </label>
                <textarea
                  value="All electronic products including laptops, phones, and tablets."
                  readOnly
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-xs rounded border bg-muted/50 mt-1 resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Custom Attributes
                </label>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <Badge variant="outline" className="text-[9px]">
                    Warranty
                  </Badge>
                  <Badge variant="outline" className="text-[9px]">
                    Voltage
                  </Badge>
                  <Badge variant="outline" className="text-[9px]">
                    Connectivity
                  </Badge>
                  <button className="text-[9px] text-primary hover:underline">
                    + Add
                  </button>
                </div>
              </div>
            </div>

            <Button size="sm" className="w-full text-xs">
              Save Changes
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

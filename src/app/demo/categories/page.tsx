"use client";

import { useState, useMemo } from "react";
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
  Search,
  ChevronsUpDown,
  ChevronsDownUp,
  Image as ImageIcon,
  Globe,
  Tag,
  Clock,
  AlertTriangle,
  Eye,
  EyeOff,
  FileText,
  Layers,
  ArrowRight,
  X,
  Check,
  ToggleLeft,
  Hash,
  Type,
  ListFilter,
  ToggleRight,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { mockCategories, mockMasterProducts } from "../mock-data";

/* ── Types ─────────────────────────────────────────────── */

type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  productCount: number;
  children: CategoryNode[];
};

/* ── Extended mock data for detail panel ───────────────── */

const categoryDetails: Record<string, {
  description: string;
  image: string | null;
  status: "active" | "draft" | "hidden";
  metaTitle: string;
  metaDescription: string;
  attributes: { name: string; type: "text" | "number" | "select" | "boolean"; required: boolean; values?: string[] }[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}> = {
  "cat-1": {
    description: "All electronic products including laptops, phones, and tablets.",
    image: null,
    status: "active",
    metaTitle: "Electronics - TechStore",
    metaDescription: "Shop the latest electronics including laptops, smartphones, tablets, and more.",
    attributes: [
      { name: "Warranty", type: "select", required: false, values: ["1 Year", "2 Years", "3 Years", "5 Years"] },
      { name: "Voltage", type: "select", required: false, values: ["110V", "220V", "Universal"] },
      { name: "Connectivity", type: "select", required: false, values: ["WiFi", "Bluetooth", "USB-C", "Lightning"] },
    ],
    createdAt: "2025-01-15T10:00:00Z",
    updatedAt: "2025-06-08T14:30:00Z",
    updatedBy: "Ahmed Al-Rashid",
  },
  "cat-2": {
    description: "Portable computers for work and entertainment.",
    image: null,
    status: "active",
    metaTitle: "Laptops - TechStore Electronics",
    metaDescription: "Browse our collection of laptops from Dell, HP, Lenovo, ASUS and more.",
    attributes: [
      { name: "Screen Size", type: "select", required: true, values: ["13\"", "14\"", "15.6\"", "16\"", "17\""] },
      { name: "RAM", type: "select", required: true, values: ["8GB", "16GB", "32GB", "64GB"] },
      { name: "Storage", type: "select", required: true, values: ["256GB SSD", "512GB SSD", "1TB SSD", "2TB SSD"] },
      { name: "Processor", type: "text", required: true },
      { name: "GPU", type: "text", required: false },
      { name: "Touchscreen", type: "boolean", required: false },
    ],
    createdAt: "2025-01-15T10:00:00Z",
    updatedAt: "2025-06-05T09:15:00Z",
    updatedBy: "Sara Hassan",
  },
  "cat-3": {
    description: "Mobile phones and smartphones from top brands.",
    image: null,
    status: "active",
    metaTitle: "Smartphones - TechStore Electronics",
    metaDescription: "Latest smartphones from Samsung, Apple, Google, and more.",
    attributes: [
      { name: "Screen Size", type: "select", required: true, values: ["6.1\"", "6.4\"", "6.7\"", "6.8\""] },
      { name: "Storage", type: "select", required: true, values: ["128GB", "256GB", "512GB", "1TB"] },
      { name: "Color", type: "text", required: true },
      { name: "5G", type: "boolean", required: false },
    ],
    createdAt: "2025-01-15T10:00:00Z",
    updatedAt: "2025-05-20T11:00:00Z",
    updatedBy: "Ahmed Al-Rashid",
  },
  "cat-9": {
    description: "Phone cases, chargers, cables, and audio accessories.",
    image: null,
    status: "active",
    metaTitle: "Accessories - TechStore",
    metaDescription: "Essential accessories for your devices.",
    attributes: [
      { name: "Compatible Device", type: "text", required: true },
      { name: "Material", type: "text", required: false },
      { name: "Color", type: "text", required: false },
    ],
    createdAt: "2025-02-01T10:00:00Z",
    updatedAt: "2025-06-01T16:00:00Z",
    updatedBy: "Omar Khalil",
  },
  "cat-13": {
    description: "Hair care and skincare products.",
    image: null,
    status: "active",
    metaTitle: "Personal Care - TechStore",
    metaDescription: "Premium personal care and grooming products.",
    attributes: [
      { name: "Skin Type", type: "select", required: false, values: ["All Skin Types", "Oily", "Dry", "Combination", "Sensitive"] },
      { name: "Volume", type: "text", required: false },
    ],
    createdAt: "2025-03-10T10:00:00Z",
    updatedAt: "2025-05-25T13:00:00Z",
    updatedBy: "Sara Hassan",
  },
};

// Generate default details for categories without explicit data
const getDetail = (catId: string, catName: string) =>
  categoryDetails[catId] || {
    description: "",
    image: null,
    status: "active" as const,
    metaTitle: `${catName} - TechStore`,
    metaDescription: "",
    attributes: [],
    createdAt: "2025-01-15T10:00:00Z",
    updatedAt: "2025-01-15T10:00:00Z",
    updatedBy: "Ahmed Al-Rashid",
  };

/* ── Helpers ───────────────────────────────────────────── */

function flattenCategories(nodes: CategoryNode[], parentPath: string[] = []): { node: CategoryNode; path: string[] }[] {
  const result: { node: CategoryNode; path: string[] }[] = [];
  for (const n of nodes) {
    const currentPath = [...parentPath, n.name];
    result.push({ node: n, path: currentPath });
    if (n.children.length > 0) {
      result.push(...flattenCategories(n.children, currentPath));
    }
  }
  return result;
}

function countAllCategories(nodes: CategoryNode[]): number {
  let count = 0;
  for (const n of nodes) {
    count += 1;
    if (n.children.length > 0) count += countAllCategories(n.children);
  }
  return count;
}

function getMaxDepth(nodes: CategoryNode[], depth = 1): number {
  let max = depth;
  for (const n of nodes) {
    if (n.children.length > 0) {
      max = Math.max(max, getMaxDepth(n.children, depth + 1));
    }
  }
  return max;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/* ── Tree Item Component ───────────────────────────────── */

function CategoryTreeItem({
  node,
  level = 0,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpand,
  searchTerm,
}: {
  node: CategoryNode;
  level?: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  searchTerm: string;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;

  // Highlight matched text
  const highlight = (text: string) => {
    if (!searchTerm) return text;
    const idx = text.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-yellow-200 dark:bg-yellow-800/50 rounded px-0.5">{text.slice(idx, idx + searchTerm.length)}</span>
        {text.slice(idx + searchTerm.length)}
      </>
    );
  };

  // Product count bar width (relative to max 450)
  const barWidth = Math.min((node.productCount / 450) * 100, 100);

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer transition-colors group ${
          isSelected ? "bg-primary/10 text-primary border border-primary/20" : "hover:bg-muted"
        }`}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground/30 shrink-0 opacity-0 group-hover:opacity-100 cursor-grab" />

        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <div className="w-5" />
        )}

        <FolderTree className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
        <span className="text-xs font-medium flex-1 truncate">{highlight(node.name)}</span>

        {/* Mini product count bar */}
        <div className="flex items-center gap-1.5 ml-1">
          <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isSelected ? "bg-primary" : "bg-muted-foreground/30"}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <Badge variant="secondary" className="text-[9px] font-mono gap-0.5 opacity-70 px-1.5">
            <Package className="h-2.5 w-2.5" />
            {node.productCount}
          </Badge>
        </div>

        <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
          <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-primary/10 text-muted-foreground hover:text-primary" title="Add child">
            <Plus className="h-3 w-3" />
          </button>
          <button className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {isExpanded &&
        hasChildren &&
        node.children.map((child) => (
          <CategoryTreeItem
            key={child.id}
            node={child}
            level={level + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            expandedIds={expandedIds}
            onToggleExpand={onToggleExpand}
            searchTerm={searchTerm}
          />
        ))}
    </div>
  );
}

/* ── Main Page Component ───────────────────────────────── */

export default function DemoCategoriesPage() {
  const [selectedId, setSelectedId] = useState<string | null>("cat-1");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(["cat-1", "cat-9", "cat-13"])
  );

  // Detail panel edit state
  const [editName, setEditName] = useState("Electronics");
  const [editSlug, setEditSlug] = useState("electronics");
  const [editDescription, setEditDescription] = useState("All electronic products including laptops, phones, and tablets.");
  const [editStatus, setEditStatus] = useState<"active" | "draft" | "hidden">("active");
  const [editMetaTitle, setEditMetaTitle] = useState("Electronics - TechStore");
  const [editMetaDesc, setEditMetaDesc] = useState("Shop the latest electronics including laptops, smartphones, tablets, and more.");
  const [showSeo, setShowSeo] = useState(false);
  const [showAttributes, setShowAttributes] = useState(true);

  const allFlat = useMemo(() => flattenCategories(mockCategories as CategoryNode[]), []);
  const totalCategories = useMemo(() => countAllCategories(mockCategories as CategoryNode[]), []);
  const maxDepth = useMemo(() => getMaxDepth(mockCategories as CategoryNode[]), []);
  const totalProducts = mockCategories.reduce((sum, c) => sum + c.productCount, 0);
  const emptyCategories = allFlat.filter((f) => f.node.productCount === 0).length;

  // Find selected category info
  const selectedFlat = allFlat.find((f) => f.node.id === selectedId);
  const selectedNode = selectedFlat?.node;
  const selectedPath = selectedFlat?.path || [];
  const selectedDetail = selectedNode ? getDetail(selectedNode.id, selectedNode.name) : null;

  // Products in selected category
  const productsInCategory = selectedNode
    ? mockMasterProducts.filter((p) => p.category === selectedNode.name || allFlat.some((f) => f.node.id === selectedId && f.node.children.some((c) => c.name === p.category)))
    : [];

  // Update detail panel when selection changes
  const handleSelect = (id: string) => {
    setSelectedId(id);
    const flat = allFlat.find((f) => f.node.id === id);
    const node = flat?.node;
    if (node) {
      const detail = getDetail(node.id, node.name);
      setEditName(node.name);
      setEditSlug(node.slug);
      setEditDescription(detail.description);
      setEditStatus(detail.status);
      setEditMetaTitle(detail.metaTitle);
      setEditMetaDesc(detail.metaDescription);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const allIds = allFlat.filter((f) => f.node.children.length > 0).map((f) => f.node.id);
    setExpandedIds(new Set(allIds));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  // Filter tree by search
  const matchingIds = useMemo(() => {
    if (!searchTerm) return null;
    const s = searchTerm.toLowerCase();
    const matching = new Set<string>();
    for (const f of allFlat) {
      if (f.node.name.toLowerCase().includes(s)) {
        matching.add(f.node.id);
        // Also add parent path IDs for visibility
        for (const ancestor of allFlat) {
          if (ancestor.node.children.some((c) => matching.has(c.id))) {
            matching.add(ancestor.node.id);
          }
        }
      }
    }
    return matching;
  }, [searchTerm, allFlat]);

  // When searching, auto-expand matching parents
  const effectiveExpandedIds = useMemo(() => {
    if (!matchingIds) return expandedIds;
    const expanded = new Set(expandedIds);
    for (const f of allFlat) {
      if (f.node.children.some((c) => matchingIds.has(c.id))) {
        expanded.add(f.node.id);
      }
    }
    return expanded;
  }, [matchingIds, expandedIds, allFlat]);

  const statusColor = {
    active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    hidden: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };

  const attrTypeIcon = {
    text: Type,
    number: Hash,
    select: ListFilter,
    boolean: ToggleRight,
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
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
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <Upload className="h-3.5 w-3.5" /> Upload CSV
          </Button>
          <Button size="sm" className="gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> Add Category
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="p-2.5 text-center">
          <div className="text-base font-bold">{totalCategories}</div>
          <div className="text-[10px] text-muted-foreground">Total Categories</div>
        </Card>
        <Card className="p-2.5 text-center">
          <div className="text-base font-bold">{mockCategories.length}</div>
          <div className="text-[10px] text-muted-foreground">Root Categories</div>
        </Card>
        <Card className="p-2.5 text-center">
          <div className="text-base font-bold">{totalProducts}</div>
          <div className="text-[10px] text-muted-foreground">Total Products</div>
        </Card>
        <Card className="p-2.5 text-center">
          <div className="text-base font-bold">{maxDepth}</div>
          <div className="text-[10px] text-muted-foreground">Max Depth</div>
        </Card>
        <Card className="p-2.5 text-center">
          <div className={`text-base font-bold ${emptyCategories > 0 ? "text-amber-600" : ""}`}>{emptyCategories}</div>
          <div className="text-[10px] text-muted-foreground">Empty Categories</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Tree View — 3 cols */}
        <div className="lg:col-span-3">
          <Card className="p-3 space-y-2">
            {/* Search + Expand/Collapse */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                <input
                  type="text"
                  placeholder="Search categories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full h-8 pl-8 pr-8 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full hover:bg-muted flex items-center justify-center"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={expandAll} title="Expand All">
                <ChevronsUpDown className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={collapseAll} title="Collapse All">
                <ChevronsDownUp className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Tree */}
            <div className="space-y-0.5">
              {(mockCategories as CategoryNode[]).map((cat) => (
                <CategoryTreeItem
                  key={cat.id}
                  node={cat}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  expandedIds={effectiveExpandedIds}
                  onToggleExpand={toggleExpand}
                  searchTerm={searchTerm}
                />
              ))}
            </div>

            {/* Empty Categories Warning */}
            {emptyCategories > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/40 mt-2">
                <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                <span className="text-[10px] text-amber-600">{emptyCategories} categories have no products assigned</span>
              </div>
            )}
          </Card>
        </div>

        {/* Details Panel — 2 cols */}
        <div className="lg:col-span-2">
          {selectedNode && selectedDetail ? (
            <Card className="p-4 space-y-4">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground flex-wrap">
                {selectedPath.map((p, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-2.5 w-2.5" />}
                    <span className={i === selectedPath.length - 1 ? "font-semibold text-foreground" : ""}>{p}</span>
                  </span>
                ))}
              </div>

              {/* Header with Status */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Category Details</h3>
                <Badge className={`text-[9px] ${statusColor[editStatus]}`}>
                  {editStatus === "active" && <Eye className="h-2.5 w-2.5 mr-0.5" />}
                  {editStatus === "draft" && <FileText className="h-2.5 w-2.5 mr-0.5" />}
                  {editStatus === "hidden" && <EyeOff className="h-2.5 w-2.5 mr-0.5" />}
                  {editStatus}
                </Badge>
              </div>

              {/* Image Upload Area */}
              <div className="border-2 border-dashed rounded-lg p-4 flex flex-col items-center gap-1.5 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors">
                <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                <span className="text-[10px] text-muted-foreground">Click to upload category image</span>
                <span className="text-[9px] text-muted-foreground/60">Recommended: 800×400px, PNG or JPG</span>
              </div>

              <div className="space-y-3">
                {/* Name */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => {
                      setEditName(e.target.value);
                      setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                    }}
                    className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1 focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>

                {/* Slug */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Slug</label>
                  <input
                    type="text"
                    value={editSlug}
                    onChange={(e) => setEditSlug(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1 font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>

                {/* Parent */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Parent</label>
                  <select className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1">
                    <option value="">None (Root)</option>
                    {allFlat.filter((f) => f.node.id !== selectedId).map((f) => (
                      <option key={f.node.id} value={f.node.id}>{"—".repeat(f.path.length - 1)} {f.node.name}</option>
                    ))}
                  </select>
                </div>

                {/* Status */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Status</label>
                  <div className="flex gap-1.5 mt-1">
                    {(["active", "draft", "hidden"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setEditStatus(s)}
                        className={`flex-1 px-2 py-1.5 rounded-md text-[10px] font-semibold capitalize transition-all border ${
                          editStatus === s
                            ? statusColor[s] + " border-current/20 shadow-sm"
                            : "border-border/50 text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className="w-full px-2.5 py-1.5 text-xs rounded border bg-background mt-1 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>

                <Separator />

                {/* SEO Fields (collapsible) */}
                <div>
                  <button
                    onClick={() => setShowSeo(!showSeo)}
                    className="flex items-center gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground w-full"
                  >
                    <Globe className="h-3 w-3" />
                    SEO Settings
                    {showSeo ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
                  </button>
                  {showSeo && (
                    <div className="space-y-2 mt-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Meta Title</label>
                        <input
                          type="text"
                          value={editMetaTitle}
                          onChange={(e) => setEditMetaTitle(e.target.value)}
                          className="w-full h-7 px-2 text-[11px] rounded border bg-background mt-0.5 focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <div className="text-[9px] text-muted-foreground/60 mt-0.5">{editMetaTitle.length}/60 characters</div>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Meta Description</label>
                        <textarea
                          value={editMetaDesc}
                          onChange={(e) => setEditMetaDesc(e.target.value)}
                          rows={2}
                          className="w-full px-2 py-1 text-[11px] rounded border bg-background mt-0.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <div className="text-[9px] text-muted-foreground/60 mt-0.5">{editMetaDesc.length}/160 characters</div>
                      </div>
                      {/* SEO Preview */}
                      <div className="p-2 rounded-md bg-muted/30 border">
                        <div className="text-[10px] font-semibold text-muted-foreground mb-1">Google Preview</div>
                        <div className="text-[11px] text-blue-600 font-medium truncate">{editMetaTitle || "Untitled"}</div>
                        <div className="text-[10px] text-green-700 font-mono truncate">techstore.com/categories/{editSlug}</div>
                        <div className="text-[10px] text-muted-foreground line-clamp-2">{editMetaDesc || "No description"}</div>
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Attribute Templates (collapsible) */}
                <div>
                  <button
                    onClick={() => setShowAttributes(!showAttributes)}
                    className="flex items-center gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground w-full"
                  >
                    <Layers className="h-3 w-3" />
                    Attribute Templates ({selectedDetail.attributes.length})
                    {showAttributes ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
                  </button>
                  {showAttributes && (
                    <div className="space-y-1.5 mt-2">
                      {selectedDetail.attributes.length > 0 ? (
                        selectedDetail.attributes.map((attr, i) => {
                          const AttrIcon = attrTypeIcon[attr.type];
                          return (
                            <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border group">
                              <AttrIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-medium">{attr.name}</span>
                                  {attr.required && <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-red-50 text-red-600 dark:bg-red-900/20">Required</Badge>}
                                  <Badge variant="secondary" className="text-[8px] px-1 py-0">{attr.type}</Badge>
                                </div>
                                {attr.values && (
                                  <div className="text-[9px] text-muted-foreground mt-0.5 truncate">
                                    {attr.values.join(", ")}
                                  </div>
                                )}
                              </div>
                              <button className="h-5 w-5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-[10px] text-muted-foreground italic">No attributes defined. Inherits from parent.</p>
                      )}
                      <button className="flex items-center gap-1.5 text-[10px] text-primary hover:underline mt-1">
                        <Plus className="h-3 w-3" /> Add Attribute
                      </button>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Products in Category */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <Package className="h-3 w-3" /> Products ({selectedNode.productCount})
                    </span>
                    <button className="text-[9px] text-primary hover:underline">View All</button>
                  </div>
                  <div className="space-y-1 mt-1.5">
                    {productsInCategory.slice(0, 4).map((p) => (
                      <div key={p.id} className="flex items-center justify-between py-1 px-2 rounded-md hover:bg-muted/50 text-[10px]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-muted-foreground">{p.sku}</span>
                          <span className="font-medium">{p.name}</span>
                        </div>
                        <span className="font-mono">${p.price}</span>
                      </div>
                    ))}
                    {productsInCategory.length === 0 && (
                      <p className="text-[10px] text-muted-foreground italic py-1">No products directly in this category</p>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Timestamps */}
                <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> Created {timeAgo(selectedDetail.createdAt)}</span>
                  <span>Updated {timeAgo(selectedDetail.updatedAt)} by {selectedDetail.updatedBy}</span>
                </div>
              </div>

              <Button size="sm" className="w-full text-xs gap-1.5">
                <Check className="h-3.5 w-3.5" /> Save Changes
              </Button>
            </Card>
          ) : (
            <Card className="p-6 flex flex-col items-center justify-center text-center min-h-[300px]">
              <FolderTree className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">Select a category to view details</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

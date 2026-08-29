"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Send,
  Paperclip,
  Globe,
  Zap,
  Sparkles,
  Loader2,
  Store,
  Download,
  Search,
  ListChecks,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  FolderTree,
  X,
  Bot,
  User as UserIcon,
  ChevronRight,
  Settings,
  Unplug,
  Crown,
  AlertTriangle,
  Undo2,
  Redo2,
  Brain,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/brand/page-loader";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { getBalance } from "@/lib/credits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  StreamingMarkdown,
  resetRevealedMessages,
} from "@/components/streaming-markdown";
import { useWorkspaceContext } from "../workspace-context";
import { useRole } from "@/hooks/use-role";
import { useSyncStore, type SyncMessage, type SyncMode, type SyncWorkingMemory, type SyncActionReceipt } from "@/store/sync-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import { getWorkspaceIntegration, type WorkspaceIntegration } from "@/lib/supabase";
import { getClientProviderSchema } from "@/lib/sync/client-schema";
import { parseGalleryImages } from "@/lib/sync/core/gallery-images";
import { SyncExportButton } from "@/components/sync/sync-export-button";
import type { ColumnProfileKey } from "@/lib/sync/core/types";

type SyncSheetRow = Record<string, any>;

type SyncSheet = {
  title: string;
  columns: string[];
  rows: SyncSheetRow[];
};

type SyncAttachmentPayload = {
  name: string;
  mimeType: string;
  size: number;
  data: string;
};

type AgentWorkingMemoryPayload = SyncWorkingMemory;

type AgentStep = {
  tool: string;
  args?: Record<string, unknown>;
};

type AgentPlan = {
  resultMode?: "answer_only" | "show_filtered_sheet" | "target_rows";
  steps: AgentStep[];
  assistantMessage?: string;
};

type PendingPlanInfo = {
  plan: AgentPlan;
  userMessage: string;
  attachmentPayloads: SyncAttachmentPayload[];
  estimatedCredits?: number;
};

// Human-readable labels for v3 tools, used in confirmation previews.
const TOOL_LABELS: Record<string, string> = {
  sync_products_load: "Load products",
  sync_products_filter_client: "Filter products",
  sync_collections_load: "Load taxonomy groups",
  sync_collections_resolve: "Resolve taxonomy group",
  sync_collections_create: "Create taxonomy group",
  sync_collections_assign: "Assign taxonomy group",
  sync_columns_write_with_ai: "Write column with AI",
  sync_images_search: "Search product images",
  sync_catalog_lookup: "Look up product in sheet",
  sync_row_append: "Add row",
  sync_sheet_program: "Filter/analyze sheet",
  sync_answer_question: "Answer question",
  sync_research_web: "Web research",
  sync_attachments_analyze: "Analyze attachments",
  sync_column_delete: "Delete column",
  sync_apply_to_shopify: "Apply changes to connected platform",
  sync_reply_only: "Reply",
};

type SheetViewKey = ColumnProfileKey;

// Human-readable labels per profile for tab buttons.
const PROFILE_LABELS: Record<ColumnProfileKey, string> = {
  core: "Core",
  pricing: "Pricing",
  seo: "SEO",
  content: "Content",
  imagery: "Imagery",
  inventory: "Inventory",
  collections: "Collections",
  publishing: "Publishing",
  taxonomy: "Taxonomy",
  translations: "Translations",
  variants: "Variants",
  metafields: "Metafields",
  all: "All fields",
};

type SyncChangeSummary = {
  creates: Array<{ rowIndex: number; row: SyncSheetRow }>;
  updates: Array<{
    rowIndex: number;
    productId: string;
    label: string;
    row: SyncSheetRow;
    changes: Array<{ column: string; before: string; after: string }>;
  }>;
};

const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "text/csv",
  "text/plain",
  "application/json",
]);

const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PDF_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function taxonomyLabel(provider?: string | null) {
  return provider === "woocommerce" ? "Categories" : "Collections";
}

function taxonomyPrompt(provider?: string | null) {
  return provider === "woocommerce"
    ? "اعرض كل تصنيفات المنتجات من WooCommerce"
    : "اعرض كل الـ collections من Shopify";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function getAttachmentValidationError(file: File) {
  if (!SUPPORTED_ATTACHMENT_MIME_TYPES.has(file.type)) {
    return `The file format for ${file.name} is not supported right now. Only JPG, PNG, WEBP, BMP, PDF, CSV, TXT, and JSON are allowed.`;
  }

  const isText = file.type.startsWith("text/") || file.type === "application/json";
  const maxSize = file.type === "application/pdf"
    ? MAX_PDF_ATTACHMENT_BYTES
    : isText
    ? MAX_TEXT_ATTACHMENT_BYTES
    : MAX_IMAGE_ATTACHMENT_BYTES;
  if (file.size > maxSize) {
    return `The file size for ${file.name} is ${formatFileSize(file.size)}, which exceeds the allowed limit of ${formatFileSize(maxSize)} for this file type.`;
  }

  return null;
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

// Dynamic sheet-view derivation from COLUMN_PROFILES (shared with the server-side
// Shopify schema catalog). The agent picks a `columnProfile` per turn which auto-selects
// the matching tab. Users can still override with any other tab.
type SheetView = { key: SheetViewKey; label: string; columns: string[] };

/**
 * Build the tab bar shown above the sheet.
 *
 * Rules (v3 intent-aware):
 * - If there's no loaded sheet or entity → return [] (hide bar).
 * - If entity is "collections" → only the `Collections` tab is valid.
 * - If entity is "products" → expose `relevantProfiles` (planner-driven), falling
 *   back to ["core","all"] when the planner didn't provide a hint. Never include
 *   the `collections` profile here — that's a different entity.
 *
 * A profile is only shown when at least one of its columns actually exists in
 * the current sheet, except for `core`/`all` which always render.
 */
function buildSheetViews(
  availableColumns: string[],
  entity: "products" | "collections" | null,
  relevantProfiles: ColumnProfileKey[] | null,
  profiles: Record<string, string[]>,
  labels: Record<ColumnProfileKey, string> = PROFILE_LABELS
): SheetView[] {
  if (!entity || availableColumns.length === 0) return [];
  const available = new Set(availableColumns);

  const toView = (key: ColumnProfileKey): SheetView => ({
    key,
    label: labels[key] ?? key,
    columns: key === "all" ? [] : profiles[key] ?? [],
  });

  if (entity === "collections") {
    return [{
      key: "collections",
      label: labels.collections ?? "Taxonomy",
      columns: availableColumns,
    }];
  }

  // Products entity — use relevantProfiles when provided; otherwise a sensible default.
  const requested: ColumnProfileKey[] =
    relevantProfiles && relevantProfiles.length > 0
      ? relevantProfiles.filter((p) => p !== "collections")
      : ["core", "all"];
  // Preserve planner order, dedupe, drop unknown keys.
  const seen = new Set<ColumnProfileKey>();
  const ordered: ColumnProfileKey[] = [];
  for (const k of requested) {
    if (seen.has(k)) continue;
    if (k !== "all" && k !== "core" && !profiles[k]) continue;
    seen.add(k);
    ordered.push(k);
  }

  return ordered
    .map(toView)
    .filter((view) => {
      if (view.key === "all" || view.key === "core") return true;
      return view.columns.some((c) => available.has(c));
    });
}

/** Column label overrides for cleaner UI display. */
const COLUMN_LABEL_MAP: Record<string, string> = {
  body_html: "Description",
  description: "Description",
  featured_image: "Image",
  featured_image_alt_text: "Image Alt Text",
  image_alt_text: "Image Alt Text",
  image_id: "Image ID",
  image_name: "Image Name",
  seo_title: "SEO Title",
  seo_description: "SEO Description",
  products_count: "Products",
  count: "Products",
  sort_order: "Sort Order",
  menu_order: "Menu Order",
  parent: "Parent ID",
  display: "Display",
  slug: "Slug",
  published: "Sales Channels",
  product_type: "Type",
  compare_at_price: "Compare Price",
  inventory_total: "Inventory",
  variant_count: "Variants",
  primary_sku: "SKU",
  updated_at: "Updated",
  created_at: "Created",
  published_at: "Published",
};

function formatColumnLabel(column: string) {
  return COLUMN_LABEL_MAP[column] ?? column.replaceAll("_", " ");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatTimestamp(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "—";
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

/** Expandable text cell — shows truncated preview, click to expand/collapse. */
function ExpandableText({ text, maxLen = 80 }: { text: string; maxLen?: number }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > maxLen;
  if (!needsTruncation) {
    return <span>{text}</span>;
  }
  return (
    <button
      type="button"
      className="text-left max-w-[320px] leading-relaxed cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
      onClick={() => setExpanded((prev) => !prev)}
      title={expanded ? "Click to collapse" : "Click to expand"}
    >
      {expanded ? (
        <span>{text}</span>
      ) : (
        <span>{truncateText(text, maxLen)}</span>
      )}
    </button>
  );
}

/** Columns that should never appear in the UI table. */
const HIDDEN_COLUMNS = new Set(["id", "gallery_media"]);

/** Thumbnail strip for the gallery cell, which holds several URLs. */
function GalleryCell({ urls }: { urls: string[] }) {
  const shown = urls.slice(0, 4);
  const overflow = urls.length - shown.length;
  return (
    <div className="flex items-center gap-1.5 min-w-[150px]">
      {shown.map((url) => (
        <img
          key={url}
          src={url}
          alt="Product gallery"
          className="h-10 w-10 rounded-md border object-cover bg-muted shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ))}
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
        {overflow > 0 ? `+${overflow} more` : `${urls.length} image${urls.length === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

function renderCellValue(column: string, value: unknown) {
  const text = String(value ?? "").trim();

  if (!text) {
    return <span className="text-muted-foreground">—</span>;
  }

  // Image columns — render as thumbnail + truncated URL caption.
  // `featured_image` is the products column; `image` is the collections one.
  // Both store a single URL string.
  if (column === "featured_image" || column === "image") {
    return (
      <div className="flex items-center gap-2 min-w-[140px]">
        <img
          src={text}
          alt={column === "image" ? "Collection" : "Product"}
          className="h-10 w-10 rounded-md border object-cover bg-muted"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="min-w-0 text-[11px] text-muted-foreground break-all">{truncateText(text, 42)}</div>
      </div>
    );
  }

  if (column === "gallery_images") {
    const urls = parseGalleryImages(text);
    if (urls.length === 0) return <span className="text-muted-foreground">—</span>;
    return <GalleryCell urls={urls} />;
  }

  // Description / body_html — expandable preview
  if (column === "body_html" || column === "description") {
    const clean = stripHtml(text);
    return <ExpandableText text={clean} maxLen={80} />;
  }

  if (column === "tags") {
    return <div className="max-w-[220px] leading-relaxed">{truncateText(text, 80)}</div>;
  }

  if (["published_at", "created_at", "updated_at"].includes(column)) {
    return <span className="whitespace-nowrap">{formatTimestamp(text)}</span>;
  }

  if (["price", "compare_at_price"].includes(column)) {
    return <span className="whitespace-nowrap font-medium">{text}</span>;
  }

  // Long generic text — also expandable
  if (text.length > 100) {
    return <ExpandableText text={text} maxLen={80} />;
  }

  return <span>{text}</span>;
}

function getSyncRowIdentity(row: SyncSheetRow | null | undefined) {
  if (!row) {
    return null;
  }

  const id = String(row.id ?? "").trim();
  if (id) {
    return `id:${id}`;
  }

  const handle = String(row.handle ?? "").trim().toLowerCase();
  if (handle) {
    return `handle:${handle}`;
  }

  return null;
}

// ─── Context usage ring (Cursor-style) ───────────────────
//
// Shows how full the agent's active context is: compressed session memory +
// the verbatim recent turns still in the window. When turns age out they get
// compacted into memory automatically, so the ring drops back down after
// each compaction instead of overflowing.

/** Rough chars→tokens estimate (≈4 chars per token). */
const estimateTokens = (chars: number) => Math.ceil(chars / 4);

/** Nominal budget for the conversational part of the prompt:
 *  12 verbatim turns × 10K chars cap + 3K chars summary ≈ 31K tokens. */
const CONTEXT_BUDGET_TOKENS = 32_000;

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function ContextUsageRing({
  messages,
  sessionSummary,
  sessionSummaryUpTo,
}: {
  messages: SyncMessage[];
  sessionSummary: string;
  sessionSummaryUpTo: number;
}) {
  const { percent, summaryTokens, convoTokens, compactedCount, liveCount } =
    useMemo(() => {
      const compacted = Math.min(
        Math.max(0, sessionSummaryUpTo),
        messages.length
      );
      const live = messages.slice(compacted);
      const convoChars = live.reduce(
        (sum, m) => sum + Math.min(m.content.length, 10_000),
        0
      );
      const summaryChars = sessionSummary.length;
      const used = estimateTokens(convoChars) + estimateTokens(summaryChars);
      return {
        percent: Math.min(100, Math.round((used / CONTEXT_BUDGET_TOKENS) * 100)),
        summaryTokens: estimateTokens(summaryChars),
        convoTokens: estimateTokens(convoChars),
        compactedCount: compacted,
        liveCount: live.length,
      };
    }, [messages, sessionSummary, sessionSummaryUpTo]);

  // Hide entirely on a brand-new chat — nothing to report yet.
  if (messages.length === 0) return null;

  const R = 5.5;
  const CIRC = 2 * Math.PI * R;
  const color =
    percent >= 85
      ? "text-red-500"
      : percent >= 60
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="flex items-center gap-1 h-8 px-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors cursor-default"
          aria-label={`Context usage ${percent}%`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className={color}>
            <circle
              cx="8"
              cy="8"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="2"
            />
            <circle
              cx="8"
              cy="8"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - percent / 100)}
              transform="rotate(-90 8 8)"
              className="transition-[stroke-dashoffset] duration-500"
            />
          </svg>
          <span className="text-[10px] font-medium tabular-nums">{percent}%</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="space-y-0.5">
          <div className="font-semibold">Chat context · {percent}% used</div>
          <div>Conversation: ~{formatTokens(convoTokens)} tokens ({liveCount} messages)</div>
          <div>Session memory: ~{formatTokens(summaryTokens)} tokens</div>
          {compactedCount > 0 && (
            <div className="text-muted-foreground">
              {compactedCount} older messages compacted into memory
            </div>
          )}
          <div className="text-muted-foreground">
            Older messages auto-summarize — the chat never overflows.
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Quick Prompt Suggestions ────────────────────────────

type QuickPrompt = {
  icon: typeof Download;
  title: string;
  description: string;
  prompt: string;
};

/** Discovery-first starters. Taxonomy card adapts to Shopify vs WooCommerce. */
function buildQuickPrompts(provider?: string | null): QuickPrompt[] {
  const taxonomy = taxonomyLabel(provider);
  const taxonomyPromptText =
    provider === "woocommerce"
      ? "Get all product categories from the connected WooCommerce store into the sheet"
      : "Get all collections from the connected Shopify store into the sheet";

  return [
    {
      icon: Download,
      title: "Get products",
      description: "Load products from the connected platform",
      prompt: "Get all products from the connected platform into a new sheet",
    },
    {
      icon: ImageIcon,
      title: "Products without images",
      description: "Show products that are missing a featured image",
      prompt:
        "Show products that are missing a featured image. Load from the store first if the sheet is empty.",
    },
    {
      icon: Search,
      title: "Missing SEO title/description",
      description: "Show products missing SEO title or description",
      prompt:
        "Show products that are missing SEO title or SEO description. Load from the store first if the sheet is empty.",
    },
    {
      icon: FolderTree,
      title: `Get all ${taxonomy.toLowerCase()}`,
      description:
        provider === "woocommerce"
          ? "Load all product categories from WooCommerce"
          : "Load all collections from Shopify",
      prompt: taxonomyPromptText,
    },
    {
      icon: ListChecks,
      title: "Show drafts",
      description: "Show draft products from the connected store",
      prompt:
        "Show draft products from the connected store. Load from the store first if the sheet is empty.",
    },
    {
      icon: FileText,
      title: "Products without description",
      description: "Show products missing a product description",
      prompt:
        "Show products that are missing a product description (body_html empty). Load from the store first if the sheet is empty.",
    },
  ];
}

// ─── Main Page Component ─────────────────────────────────

export default function SyncPage() {
  const PAGE_SIZE = 50;
  const router = useRouter();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const basePath = `/w/${slug}`;
  const { workspace, role } = useWorkspaceContext();
  const { canEdit } = useRole(role);
  const invalidateCredits = useWorkspaceStore((s) => s.invalidateCredits);

  const {
    isFocusMode,
    setFocusMode,
    messages,
    addMessage,
    updateLastAssistantMessage,
    updateLastAssistantThinking,
    updateLastAssistantProgress,
    updateLastAssistantSessionSummary,
    sessionSummary,
    sessionSummaryUpTo,
    setSessionSummaryUpTo,
    isStreaming,
    setStreaming,
    mode,
    setMode,
    thinkingLevel,
    setThinkingLevel,
    webEnabled,
    toggleWebEnabled,
    pendingAttachments,
    addPendingAttachment,
    removePendingAttachment,
    clearPendingAttachments,
    workingMemory,
    setWorkingMemory,
    pushSheetSnapshot,
    pushRedoSnapshot,
    undoSheet,
    redoSheet,
    sheetHistory,
    redoHistory,
    updateLastAssistantActionReceipt,
    appendAssistantTraceEvent,
    setRemainingCount,
    resetChat,
  } = useSyncStore();

  const [integration, setIntegration] = useState<WorkspaceIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [resultsTitle, setResultsTitle] = useState<string>("Results Workspace");
  const [resultColumns, setResultColumns] = useState<string[]>([]);
  const [resultRows, setResultRows] = useState<Record<string, any>[]>([]);
  const [originalSheet, setOriginalSheet] = useState<SyncSheet | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [sheetView, setSheetView] = useState<SheetViewKey>("core");
  // Active row filter: when set, only these row indexes are displayed in the table
  const [filteredRowIndexes, setFilteredRowIndexes] = useState<number[] | null>(null);
  const [filterDescription, setFilterDescription] = useState<string | null>(null);
  // Which assistant message IDs have their thinking section expanded.
  // Auto-expands for the current streaming message so the user sees text live.
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const toggleThinking = useCallback((id: string) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Auto-expand the thinking section of the last assistant message when
  // streaming starts so the user sees thinking text appear live.
  const lastMsgId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (isStreaming && lastMsgId) {
      setExpandedThinking((prev) => {
        if (prev.has(lastMsgId)) return prev;
        const next = new Set(prev);
        next.add(lastMsgId);
        return next;
      });
    }
  }, [isStreaming, lastMsgId]);

  // Live progress for long-running AI writes / image searches. Cleared when
  // the tool finishes (result event) or the user cancels.
  const [liveProgress, setLiveProgress] = useState<{
    tool: string;
    column?: string;
    processed: number;
    total: number;
    percent: number;
    failedCount?: number;
  } | null>(null);
  const currentColumnProfile = useSyncStore((s) => s.currentColumnProfile);
  const setColumnProfile = useSyncStore((s) => s.setColumnProfile);
  const currentEntity = useSyncStore((s) => s.currentEntity);
  const setEntity = useSyncStore((s) => s.setEntity);
  const relevantProfiles = useSyncStore((s) => s.relevantProfiles);
  const setRelevantProfiles = useSyncStore((s) => s.setRelevantProfiles);
  const remainingCount = useSyncStore((s) => s.remainingCount);

  // When the agent returns a columnProfile, auto-switch the UI tab.
  useEffect(() => {
    if (currentColumnProfile && currentColumnProfile !== sheetView) {
      setSheetView(currentColumnProfile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentColumnProfile]);

  const profileLabels = useMemo(
    () => ({
      ...PROFILE_LABELS,
      collections: taxonomyLabel(integration?.provider),
    }),
    [integration?.provider]
  );

  const quickPrompts = useMemo(
    () => buildQuickPrompts(integration?.provider),
    [integration?.provider]
  );

  const providerSchema = useMemo(
    () => getClientProviderSchema(integration?.provider),
    [integration?.provider]
  );

  const sheetViews = useMemo(
    () => buildSheetViews(resultColumns, currentEntity, relevantProfiles, providerSchema.columnProfiles, profileLabels),
    [resultColumns, currentEntity, relevantProfiles, providerSchema, profileLabels]
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [chatBlockedReason, setChatBlockedReason] = useState<"NO_CREDITS" | "NO_SUBSCRIPTION" | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PendingPlanInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setSheet = useCallback((sheet: SyncSheet) => {
    setResultsTitle(sheet.title);
    setResultColumns(sheet.columns);
    setResultRows(sheet.rows);
    setCurrentPage(1);
  }, []);

  const setOriginalAndWorkingSheet = useCallback((sheet: SyncSheet) => {
    setOriginalSheet({
      title: sheet.title,
      columns: [...sheet.columns],
      rows: sheet.rows.map((row) => ({ ...row })),
    });
    // Clear any active filter when loading a fresh sheet
    setFilteredRowIndexes(null);
    setFilterDescription(null);
    setSheet(sheet);
  }, [setSheet]);

  const currentSheet: SyncSheet | null =
    resultColumns.length > 0 || resultRows.length > 0
      ? {
          title: resultsTitle,
          columns: resultColumns,
          rows: resultRows,
        }
      : null;

  const visibleColumns: string[] = (() => {
    const activeView = sheetViews.find((view: SheetView) => view.key === sheetView);
    let cols: string[];
    if (!activeView || activeView.key === "all") {
      cols = resultColumns;
    } else {
      const scopedColumns = activeView.columns.filter((column: string) => resultColumns.includes(column));
      cols = scopedColumns.length > 0 ? scopedColumns : resultColumns;
    }
    // Hide internal columns (e.g. id) from UI display
    return cols.filter((c) => !HIDDEN_COLUMNS.has(c));
  })();

  // When a filter is active, show only the matching rows; otherwise show all
  const displayRows = filteredRowIndexes
    ? filteredRowIndexes.map((i) => resultRows[i]).filter(Boolean)
    : resultRows;
  const totalPages = Math.max(1, Math.ceil(displayRows.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRows = displayRows.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE);

  const pendingChangeCount = (() => {
    if (!originalSheet || !currentSheet) {
      return 0;
    }

    const originalRowMap = new Map(
      originalSheet.rows
        .map((row) => {
          const identity = getSyncRowIdentity(row);
          return identity ? [identity, row] as const : null;
        })
        .filter(Boolean) as Array<readonly [string, SyncSheetRow]>
    );

    let count = 0;

    for (let rowIndex = 0; rowIndex < currentSheet.rows.length; rowIndex += 1) {
      const currentRow = currentSheet.rows[rowIndex];
      const identity = getSyncRowIdentity(currentRow);
      const originalRow = identity ? originalRowMap.get(identity) : originalSheet.rows[rowIndex];

      if (!originalRow) {
        count += 1;
        continue;
      }

      const hasRowChange = currentSheet.columns.some((column) => {
        return String(originalRow[column] ?? "") !== String(currentRow[column] ?? "");
      });

      if (hasRowChange) {
        count += 1;
      }
    }

    return count;
  })();

  const changeSummary: SyncChangeSummary = (() => {
    if (!originalSheet || !currentSheet) {
      return { creates: [], updates: [] };
    }

    const originalRowMap = new Map(
      originalSheet.rows
        .map((row) => {
          const identity = getSyncRowIdentity(row);
          return identity ? [identity, row] as const : null;
        })
        .filter(Boolean) as Array<readonly [string, SyncSheetRow]>
    );

    const creates: SyncChangeSummary["creates"] = [];
    const updates: SyncChangeSummary["updates"] = [];

    for (let rowIndex = 0; rowIndex < currentSheet.rows.length; rowIndex += 1) {
      const currentRow = currentSheet.rows[rowIndex];
      const identity = getSyncRowIdentity(currentRow);
      const originalRow = identity ? originalRowMap.get(identity) : originalSheet.rows[rowIndex];

      if (!originalRow) {
        creates.push({ rowIndex, row: currentRow });
        continue;
      }

      const changes = currentSheet.columns
        .map((column) => ({
          column,
          before: String(originalRow[column] ?? ""),
          after: String(currentRow[column] ?? ""),
        }))
        .filter((item) => item.before !== item.after);

      if (changes.length > 0) {
        updates.push({
          rowIndex,
          productId: String(currentRow.id ?? originalRow.id ?? ""),
          label: String(currentRow.title ?? currentRow.handle ?? `Row ${rowIndex + 1}`),
          row: currentRow,
          changes,
        });
      }
    }

    return { creates, updates };
  })();

  const processAgentStream = useCallback(
    async (
      response: Response,
      opts?: { onNeedsConfirmation?: (plan: AgentPlan) => void }
    ) => {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Failed to read agent response stream");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          const event = JSON.parse(trimmedLine) as
            | { type: "ping" }
            | { type: "progress"; progress: string[] }
            | { type: "plan"; data: any }
            | { type: "step.start"; data: { index: number; tool: string; args: any } }
            | { type: "step.end"; data: { index: number; tool: string; output: any; warnings?: string[]; userErrorCount?: number; elapsedMs: number } }
            | { type: "thinking"; data: { text: string; turn: number; partial?: boolean } }
            | {
                type: "tool_progress";
                data: {
                  index: number;
                  tool: string;
                  column?: string;
                  processed: number;
                  total: number;
                  percent: number;
                  partialValues?: Array<{ rowIndex: number; column: string; value: string }>;
                  failedCount?: number;
                };
              }
            | { type: "reflection"; data: { stepIndex: number; decision: string; rationale: string } }
            | { type: "working_memory"; data: AgentWorkingMemoryPayload }
            | { type: "needs_confirmation"; data: { plan: AgentPlan } }
            | {
                type: "result";
                data: {
                  assistantMessage?: string;
                  progress?: string[];
                  sessionSummary?: string;
                  sessionSummaryUpTo?: number;
                  sheet?: SyncSheet;
                  columnProfile?: string;
                  remainingCount?: number | null;
                  executedSteps?: Array<{ tool: string }>;
                  workingMemory?: AgentWorkingMemoryPayload;
                  actionReceipt?: SyncActionReceipt;
                };
              }
            | { type: "error"; error: string };

          if (event.type === "ping") continue;

          if (event.type === "needs_confirmation") {
            opts?.onNeedsConfirmation?.(event.data.plan);
            // Stop reading — the run is paused awaiting user approval.
            try { await reader.cancel(); } catch { /* ignore */ }
            return;
          }

          // v3 plan event — no UI yet, consumed silently for future use.
          if (event.type === "plan") continue;

          if (event.type === "step.start") {
            appendAssistantTraceEvent({
              kind: "step_start",
              index: event.data.index,
              tool: event.data.tool,
              args: event.data.args,
              startedAt: Date.now(),
            });
            continue;
          }

          if (event.type === "thinking") {
            updateLastAssistantThinking(event.data.text, event.data.partial);
            continue;
          }

          if (event.type === "step.end") {
            appendAssistantTraceEvent({
              kind: "step_end",
              index: event.data.index,
              tool: event.data.tool,
              elapsedMs: event.data.elapsedMs,
              warnings: event.data.warnings,
              userErrorCount: event.data.userErrorCount,
              output: event.data.output,
            });
            // The tool that just finished — clear the live progress widget
            // so it doesn't linger between turns.
            setLiveProgress((prev) =>
              prev && prev.tool === event.data.tool ? null : prev
            );
            continue;
          }

          if (event.type === "tool_progress") {
            // 1) Merge partial values into the live sheet so cells fill in
            //    progressively as each batch lands (no waiting for tool_result).
            if (Array.isArray(event.data.partialValues) && event.data.partialValues.length > 0) {
              const updates = event.data.partialValues;
              setResultColumns((prev) =>
                event.data.column && !prev.includes(event.data.column)
                  ? [...prev, event.data.column]
                  : prev
              );
              setResultRows((prev) => {
                const next = prev.slice();
                for (const { rowIndex, column, value } of updates) {
                  if (rowIndex < 0 || rowIndex >= next.length) continue;
                  next[rowIndex] = { ...next[rowIndex], [column]: value };
                }
                return next;
              });
            }
            // 2) Update the floating progress widget.
            setLiveProgress({
              tool: event.data.tool,
              column: event.data.column,
              processed: event.data.processed,
              total: event.data.total,
              percent: event.data.percent,
              failedCount: event.data.failedCount,
            });
            continue;
          }

          if (event.type === "reflection") {
            appendAssistantTraceEvent({
              kind: "reflection",
              stepIndex: event.data.stepIndex,
              decision: event.data.decision,
              rationale: event.data.rationale,
            });
            continue;
          }

          if (event.type === "working_memory") {
            if (event.data) {
              setWorkingMemory(event.data);
              setEntity(event.data.lastEntity ?? null);
              setRelevantProfiles(
                Array.isArray(event.data.lastRelevantProfiles)
                  ? (event.data.lastRelevantProfiles as ColumnProfileKey[])
                  : null
              );
              if (event.data.lastColumnProfile) {
                setColumnProfile(event.data.lastColumnProfile as ColumnProfileKey);
              }
              // When the agent targets rows (filter/show_filtered), activate the UI filter;
              // when the agent performs a different action, clear any stale filter.
              if (
                event.data.lastActionType === "target_rows" &&
                Array.isArray(event.data.lastTargetedRowIndexes) &&
                event.data.lastTargetedRowIndexes.length > 0
              ) {
                setFilteredRowIndexes(event.data.lastTargetedRowIndexes);
                setFilterDescription(event.data.lastFilterDescription ?? null);
                setCurrentPage(1);
              } else if (event.data.lastActionType && event.data.lastActionType !== "target_rows") {
                setFilteredRowIndexes(null);
                setFilterDescription(null);
              }
            }
            continue;
          }

          if (event.type === "progress") {
            updateLastAssistantProgress(event.progress);
            continue;
          }

          if (event.type === "result") {
            if (event.data?.sheet && Array.isArray(event.data.sheet.columns) && Array.isArray(event.data.sheet.rows)) {
              const nextSheet = {
                title: event.data.sheet.title || "Results Workspace",
                columns: event.data.sheet.columns,
                rows: event.data.sheet.rows,
              };
              const executedSteps = Array.isArray(event.data?.executedSteps)
                ? event.data.executedSteps
                : [];
              const loadedFreshSource = executedSteps.some(
                (step) =>
                  step.tool === "sync_products_load" ||
                  step.tool === "sync_collections_load"
              );
              const appliedToShopify = executedSteps.some(
                (step) => step.tool === "sync_apply_to_shopify"
              );

              // Push current sheet as snapshot before replacing (for undo)
              if (resultColumns.length > 0 || resultRows.length > 0) {
                pushSheetSnapshot({
                  title: resultsTitle,
                  columns: resultColumns,
                  rows: resultRows,
                });
              }

              if (loadedFreshSource || appliedToShopify || !originalSheet) {
                setOriginalAndWorkingSheet(nextSheet);
              } else {
                setSheet(nextSheet);
              }
            }

            if (Array.isArray(event.data?.progress)) {
              updateLastAssistantProgress(event.data.progress);
            }

            if (typeof event.data?.sessionSummary === "string") {
              updateLastAssistantSessionSummary(event.data.sessionSummary);
            }
            if (typeof event.data?.sessionSummaryUpTo === "number") {
              setSessionSummaryUpTo(event.data.sessionSummaryUpTo);
            }

            if (event.data?.columnProfile) {
              setColumnProfile(event.data.columnProfile as ColumnProfileKey);
            }

            if (event.data?.remainingCount !== undefined) {
              setRemainingCount(event.data.remainingCount);
            }

            if (event.data?.workingMemory) {
              setWorkingMemory(event.data.workingMemory);
              // Also check for filter in result's workingMemory
              if (
                event.data.workingMemory.lastActionType === "target_rows" &&
                Array.isArray(event.data.workingMemory.lastTargetedRowIndexes) &&
                event.data.workingMemory.lastTargetedRowIndexes.length > 0
              ) {
                setFilteredRowIndexes(event.data.workingMemory.lastTargetedRowIndexes);
                setFilterDescription(event.data.workingMemory.lastFilterDescription ?? null);
                setCurrentPage(1);
              }
            }

            if (event.data?.actionReceipt) {
              updateLastAssistantActionReceipt(event.data.actionReceipt);
            }

            updateLastAssistantMessage(event.data?.assistantMessage || "Done.");
            // Clear the live progress widget — the run is fully resolved.
            setLiveProgress(null);
            continue;
          }

          if (event.type === "error") {
            updateLastAssistantMessage(`⚠️ ${event.error}`);
            setLiveProgress(null);
          }
        }
      }
    },
    [
      originalSheet,
      setOriginalAndWorkingSheet,
      setSheet,
      setWorkingMemory,
      updateLastAssistantMessage,
      updateLastAssistantThinking,
      updateLastAssistantProgress,
      updateLastAssistantSessionSummary,
      setSessionSummaryUpTo,
      updateLastAssistantActionReceipt,
      appendAssistantTraceEvent,
      pushSheetSnapshot,
      resultColumns,
      resultRows,
      resultsTitle,
      setColumnProfile,
      setRemainingCount,
    ]
  );

  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreaming(false);
    setLiveProgress(null);
    updateLastAssistantProgress([]);
    updateLastAssistantMessage("Stopped.");
  }, [setStreaming, updateLastAssistantMessage, updateLastAssistantProgress]);

  const handleUndo = useCallback(() => {
    if (!canEdit) return;
    const snapshot = undoSheet();
    if (!snapshot) {
      toast.info("There are no previous changes to undo.");
      return;
    }
    if (currentSheet) {
      pushRedoSnapshot(currentSheet);
    }
    setSheet(snapshot);
    toast.success("The last change was undone.");
  }, [currentSheet, pushRedoSnapshot, undoSheet, setSheet, canEdit]);

  const handleRedo = useCallback(() => {
    if (!canEdit) return;
    const snapshot = redoSheet();
    if (!snapshot) {
      toast.info("There are no changes to redo.");
      return;
    }
    if (currentSheet) {
      pushSheetSnapshot(currentSheet);
    }
    setSheet(snapshot);
    toast.success("The undone change was restored.");
  }, [currentSheet, pushSheetSnapshot, redoSheet, setSheet, canEdit]);

  // Fetch integration on mount
  useEffect(() => {
    if (!workspace?.id) return;
    getWorkspaceIntegration(workspace.id)
      .then(setIntegration)
      .catch(() => setIntegration(null))
      .finally(() => setLoading(false));
  }, [workspace?.id]);

  useEffect(() => {
    resetChat();
    resetRevealedMessages();

    return () => {
      resetChat();
      resetRevealedMessages();
    };
  }, [resetChat]);

  // Auto-enter focus mode when first message is sent
  useEffect(() => {
    if (messages.length > 0 && !isFocusMode) {
      setFocusMode(true);
    }
  }, [messages.length, isFocusMode, setFocusMode]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Only the newest message may type itself in — anything above it is history
  // the user has already read.
  const lastMessageId = messages[messages.length - 1]?.id;

  // Called on every frame of the reply's typing animation. Only follows the
  // text while the user is already at the bottom, so scrolling up to re-read
  // earlier turns isn't yanked back down.
  const keepChatPinnedToBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 140) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Auto-resize textarea
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
    },
    []
  );

  // File upload handler
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!canEdit) return;
      const files = e.target.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        const error = getAttachmentValidationError(files[i]);
        if (error) {
          toast.error("Failed to attach file", { description: error });
          continue;
        }
        addPendingAttachment(files[i]);
      }
      e.target.value = "";
    },
    [addPendingAttachment, canEdit]
  );

  // Send message
  // Helper: build the common request body
  const buildAgentRequestBody = useCallback(
    (trimmed: string, attachmentPayloads: SyncAttachmentPayload[], extra: Record<string, unknown> = {}) => ({
      workspaceId: workspace?.id,
      userMessage: trimmed,
      messages: [...messages, { role: "user" as const, content: trimmed }].map((message) => ({
        role: message.role,
        content: message.content,
      })),
      sessionSummary,
      sessionSummaryUpTo,
      mode,
      thinkingLevel,
      webEnabled,
      attachments: attachmentPayloads,
      integration: integration
        ? {
          provider: integration.provider,
          integration_name: integration.integration_name,
          base_url: integration.base_url,
        }
        : null,
      currentSheet,
      originalSheet,
      workingMemory,
      ...extra,
    }),
    [workspace?.id, messages, sessionSummary, sessionSummaryUpTo, mode, thinkingLevel, webEnabled, integration, currentSheet, originalSheet, workingMemory]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Unified agent runner — every interaction (chat, apply, continue, confirm)
  // goes through this single function. The server is the source of truth for:
  //   • Whether the plan needs confirmation (via `needs_confirmation` event)
  //   • Tool execution, ordering, locks, tracing, working memory updates
  // The client only renders stream events and (optionally) shows a confirm
  // preview when the server requests one.
  // ──────────────────────────────────────────────────────────────────────────
  const runAgent = useCallback(
    async (
      trimmed: string,
      attachmentPayloads: SyncAttachmentPayload[],
      opts: { preApprovedPlan?: AgentPlan } = {}
    ) => {
      if (!canEdit) return;
      setStreaming(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      let confirmationPlan: AgentPlan | null = null;
      try {
        const extra = opts.preApprovedPlan ? { preApprovedPlan: opts.preApprovedPlan } : {};
        const res = await fetch("/api/sync/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(buildAgentRequestBody(trimmed, attachmentPayloads, extra)),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to get response" }));
          if (res.status === 402) {
            setChatBlockedReason(
              err?.error === "NO_SUBSCRIPTION" ? "NO_SUBSCRIPTION" : "NO_CREDITS"
            );
            updateLastAssistantMessage("");
            updateLastAssistantProgress([]);
            return;
          }
          updateLastAssistantMessage(`⚠️ ${err.error || "Something went wrong"}`);
          return;
        }

        await processAgentStream(res, {
          onNeedsConfirmation: (plan) => {
            confirmationPlan = plan;
          },
        });

        if (confirmationPlan) {
          const plan = confirmationPlan as AgentPlan;
          setPendingPlan({ plan, userMessage: trimmed, attachmentPayloads });
          const stepLabels = plan.steps
            .map((s) => TOOL_LABELS[s.tool] || s.tool)
            .join(" → ");
          updateLastAssistantMessage(
            `📋 **Plan preview:**\n${plan.assistantMessage || ""}\n\nSteps: ${stepLabels}\n\n_Waiting for your confirmation to proceed._`
          );
          updateLastAssistantProgress([]);
        } else {
          invalidateCredits();
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        updateLastAssistantMessage(`⚠️ ${err?.message || "Network error"}`);
      } finally {
        abortControllerRef.current = null;
        // Only clear streaming when the run is fully resolved (no pending
        // confirmation). When confirmation is needed, streaming stays on so the
        // composer remains locked until the user confirms or dismisses.
        if (!confirmationPlan) {
          setStreaming(false);
        }
      }
    },
    [
      buildAgentRequestBody,
      processAgentStream,
      invalidateCredits,
      setStreaming,
      setChatBlockedReason,
      setPendingPlan,
      updateLastAssistantMessage,
      updateLastAssistantProgress,
      canEdit,
    ]
  );

  const handleSend = useCallback(async () => {
    if (!canEdit) return;
    const trimmed = input.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    if (isStreaming) return;
    if (chatBlockedReason) return;

    if (workspace?.id) {
      const balance = await getBalance(workspace.id);
      if (balance.remaining <= 0) {
        setChatBlockedReason("NO_CREDITS");
        return;
      }
    }

    let attachmentPayloads: SyncAttachmentPayload[] = [];
    try {
      attachmentPayloads = await Promise.all(
        pendingAttachments.map(async (file) => ({
          name: file.name,
          mimeType: file.type,
          size: file.size,
          data: await fileToBase64(file),
        }))
      );
    } catch {
      toast.error("Failed to prepare attachments", {
        description: "Failed to read the image or PDF file. Try again or use a smaller file.",
      });
      return;
    }

    const userMessage: SyncMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
      attachments: pendingAttachments.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        type: f.type,
        size: f.size,
      })),
    };

    addMessage(userMessage);
    setInput("");
    clearPendingAttachments();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Create placeholder assistant message
    addMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      progress: ["Analyzing your request..."],
    });

    // Single streaming POST. Server decides whether to confirm or execute.
    await runAgent(trimmed, attachmentPayloads, {});
  }, [
    chatBlockedReason,
    input,
    pendingAttachments,
    isStreaming,
    workspace?.id,
    addMessage,
    setChatBlockedReason,
    clearPendingAttachments,
    runAgent,
    canEdit,
  ]);

  // User confirms the pending plan — re-runs the agent with `preApprovedPlan`
  // so the server skips the confirmation gate and executes immediately.
  const handleConfirmPlan = useCallback(async () => {
    if (!canEdit || !pendingPlan) return;
    const { plan, userMessage, attachmentPayloads } = pendingPlan;
    setPendingPlan(null);
    updateLastAssistantMessage("");
    updateLastAssistantProgress(["Executing approved plan..."]);
    await runAgent(userMessage, attachmentPayloads, { preApprovedPlan: plan });
  }, [pendingPlan, runAgent, updateLastAssistantMessage, updateLastAssistantProgress, canEdit]);

  // User dismisses the pending plan
  const handleDismissPlan = useCallback(() => {
    setPendingPlan(null);
    setStreaming(false);
    updateLastAssistantMessage("Plan cancelled.");
    updateLastAssistantProgress([]);
  }, [setStreaming, updateLastAssistantMessage, updateLastAssistantProgress]);

  // Apply pending sheet changes — routes through the agent so the server's
  // policy gate, advisory lock, tracer and working memory all apply uniformly.
  // The user's intent is conveyed as a chat message; the planner emits a single
  // `sync_apply_to_shopify` step which the orchestrator executes after asking
  // the user for confirmation (apply is in the "red" tier).
  const handleApplySync = useCallback(async () => {
    if (
      !canEdit ||
      !workspace?.id ||
      !integration ||
      !currentSheet ||
      pendingChangeCount === 0 ||
      isApplying ||
      isStreaming
    ) {
      return;
    }

    const message = `Apply ${pendingChangeCount} pending sheet change${pendingChangeCount === 1 ? "" : "s"} to the connected platform.`;

    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    });
    addMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      progress: ["Preparing apply…"],
    });

    setIsApplying(true);
    try {
      await runAgent(message, []);
    } finally {
      setIsApplying(false);
    }
  }, [
    addMessage,
    currentSheet,
    integration,
    isApplying,
    isStreaming,
    pendingChangeCount,
    runAgent,
    workspace?.id,
    canEdit,
  ]);

  // Continue (load more) — sends a follow-up agent message that uses the
  // remembered targets / cursor in working memory to fetch the next page.
  const handleContinueLoad = useCallback(async () => {
    if (!canEdit || isStreaming || !workspace?.id || !integration) return;
    const message = "Continue loading more products from where we left off.";
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    });
    addMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      progress: ["Loading more products…"],
    });
    await runAgent(message, []);
  }, [addMessage, integration, isStreaming, runAgent, workspace?.id, canEdit]);

  // Handle quick prompt click
  const handleQuickPrompt = useCallback(
    (prompt: string) => {
      if (!canEdit) return;
      setInput(prompt);
      textareaRef.current?.focus();
    },
    [canEdit]
  );

  // Handle keyboard submit
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Exit focus mode
  const handleBack = useCallback(() => {
    resetChat();
    router.push(basePath);
  }, [resetChat, router, basePath]);

  // ─── Render States ─────────────────────────────────

  if (loading) {
    return <PageLoader />;
  }

  if (!integration) {
    return (
      <div className="autommerce-dashboard flex-1 flex items-center justify-center p-8 [font-family:var(--brand-font)]">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-[#400095]/10 to-[#F76D01]/10 flex items-center justify-center">
            <Unplug className="h-8 w-8 text-[#6B358D] dark:text-[#F76D01]" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black">Integration Required</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect a platform in Settings to start using Sync. Once connected, you can
              import, compare, and manage your data with AI.
            </p>
          </div>
          <Button
            onClick={() => router.push(`${basePath}/settings`)}
            className="gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
          >
            <Settings className="h-4 w-4" />
            Go to Settings
          </Button>
        </div>
      </div>
    );
  }

  // ─── Live progress widget (column writes / image search) ──
  // Renders a small floating card whenever the agent is mid-batch on a
  // long-running tool. The user sees throughput in real time and can hit
  // "Stop" to abort gracefully (the handler exits at the next batch boundary).
  const liveProgressWidget = liveProgress ? (
    <div className="fixed bottom-24 right-6 z-50 w-80 rounded-xl border bg-background/95 backdrop-blur shadow-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#6B358D] dark:text-[#F76D01] shrink-0" />
          <div className="text-xs font-medium truncate">
            {liveProgress.tool === "sync_images_search"
              ? "Finding images"
              : liveProgress.column
                ? `Writing ${liveProgress.column}`
                : "Working"}
          </div>
        </div>
        <button
          type="button"
          onClick={handleStopStreaming}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
        >
          Stop
        </button>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-[#400095] dark:bg-[#F76D01] transition-all duration-300 ease-out"
          style={{ width: `${liveProgress.percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {liveProgress.processed} / {liveProgress.total}
        </span>
        <span>
          {liveProgress.percent}%
          {liveProgress.failedCount && liveProgress.failedCount > 0 ? (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              · {liveProgress.failedCount} failed
            </span>
          ) : null}
        </span>
      </div>
    </div>
  ) : null;

  // ─── Composer (shared between onboarding and focused) ──

  const composerElement = (
    <div className="border-t bg-background p-3">
      <Dialog open={!!chatBlockedReason} onOpenChange={(open) => !open && setChatBlockedReason(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {chatBlockedReason === "NO_SUBSCRIPTION" ? (
                <Crown className="h-4 w-4 text-[#6B358D] dark:text-[#F76D01]" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
              {chatBlockedReason === "NO_SUBSCRIPTION" ? "Subscription required" : "No AI credits remaining"}
            </DialogTitle>
            <DialogDescription>
              {chatBlockedReason === "NO_SUBSCRIPTION"
                ? "You need an active subscription to keep using Sync AI. Renew or subscribe to continue chat requests."
                : "Your AI credits have run out. Upgrade your plan or wait for the monthly reset to continue using Sync AI."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button onClick={() => router.push(`${basePath}/subscription`)}>
              {chatBlockedReason === "NO_SUBSCRIPTION" ? "View plans" : "Manage subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {chatBlockedReason && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {chatBlockedReason === "NO_SUBSCRIPTION"
            ? "Sync AI is locked until this workspace has an active subscription."
            : "Sync AI is locked because this workspace has no remaining AI credits."}
        </div>
      )}

      {/* Pending attachments */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingAttachments.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted text-xs font-medium"
            >
              {file.type.startsWith("image/") ? (
                <ImageIcon className="h-3 w-3 text-muted-foreground" />
              ) : file.type.includes("pdf") ? (
                <FileText className="h-3 w-3 text-muted-foreground" />
              ) : (
                <FileIcon className="h-3 w-3 text-muted-foreground" />
              )}
              <span className="max-w-[120px] truncate">{file.name}</span>
              <button
                onClick={() => removePendingAttachment(i)}
                className="ml-0.5 hover:text-destructive transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={canEdit ? "Describe what you want to do..." : "View only"}
            rows={1}
            disabled={isStreaming || !!chatBlockedReason || !canEdit}
            className="w-full resize-none rounded-xl border bg-muted/30 px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-[#6B358D]/30 focus:border-[#6B358D]/40 dark:focus:ring-[#F76D01]/30 dark:focus:border-[#F76D01]/40 disabled:opacity-50 transition-all"
            style={{ maxHeight: 200 }}
          />
        </div>

        <Button
          size="icon"
          onClick={isStreaming ? handleStopStreaming : handleSend}
          disabled={!canEdit || !!chatBlockedReason || (!isStreaming && !input.trim() && pendingAttachments.length === 0)}
          className="h-10 w-10 rounded-xl shrink-0 bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2 mt-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          accept="image/jpeg,image/png,image/webp,image/bmp,.pdf"
          onChange={handleFileSelect}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!canEdit}
              className="flex items-center justify-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-40"
              aria-label="Upload files"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Upload files</TooltipContent>
        </Tooltip>

        <button
          onClick={toggleWebEnabled}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            webEnabled
              ? "bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/10 dark:text-[#F76D01]"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          aria-label={webEnabled ? "Web research enabled" : "Enable web research"}
          title={
            webEnabled
              ? "Web research on (text search). Product images always search the web."
              : "Enable web research (text). Product image search works without this."
          }
        >
          <Globe className="h-4 w-4" />
        </button>

        <div className="flex items-center bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setMode("fast")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
              mode === "fast"
                ? "bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Zap className="h-3 w-3" />
            Fast
          </button>
          <button
            onClick={() => setMode("pro")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
              mode === "pro"
                ? "bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Pro
          </button>
        </div>

        {/* ── Thinking depth (Gemini 3 thinkingLevel) ────────────────────── */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 h-8 px-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground transition-colors"
                  aria-label={`Thinking: ${thinkingLevel}`}
                >
                  <Brain className="h-4 w-4" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide">
                    {thinkingLevel === "low" ? "L" : thinkingLevel === "medium" ? "M" : "H"}
                  </span>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Reasoning depth</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Thinking depth
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {([
              { value: "low" as const, label: "Low", desc: "Fastest — quick replies" },
              { value: "medium" as const, label: "Medium", desc: "Balanced quality + speed" },
              { value: "high" as const, label: "High", desc: "Deepest reasoning, slower" },
            ]).map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onSelect={() => setThinkingLevel(opt.value)}
                className="flex flex-col items-start gap-0.5 py-2 cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  <span className="text-xs font-semibold">{opt.label}</span>
                  {thinkingLevel === opt.value && (
                    <Check className="h-3.5 w-3.5 ml-auto text-[#6B358D] dark:text-[#F76D01]" />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <ContextUsageRing
          messages={messages}
          sessionSummary={sessionSummary}
          sessionSummaryUpTo={sessionSummaryUpTo}
        />

        {integration && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
            <Store className="h-3 w-3" />
            <span className="truncate max-w-[140px]">{integration.integration_name}</span>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Focused Workspace (after first message) ──────────

  if (messages.length > 0) {
    return (
      <div className="autommerce-dashboard flex flex-col h-full min-h-0 overflow-hidden bg-background [font-family:var(--brand-font)]">
        {liveProgressWidget}
        {/* Split Workspace */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left: Chat Panel */}
          <div className="w-[460px] min-w-[360px] border-r flex flex-col min-h-0 overflow-hidden bg-background">
            {/* Messages */}
            <div
              ref={messagesScrollRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4"
            >
              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-3">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      msg.role === "user"
                        ? "bg-[#400095] text-white dark:bg-[#F76D01]"
                        : "bg-muted"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <UserIcon className="h-3.5 w-3.5" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-muted-foreground mb-1">
                      {msg.role === "user" ? "You" : "Sync AI"}
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {msg.role === "user" ? msg.content : null}
                    </div>

                    {/* ── Inline Thinking indicator (only while streaming) ── */}
                    {msg.role === "assistant" &&
                      isStreaming &&
                      msg.id === messages[messages.length - 1]?.id && (
                        <div className="text-sm">
                          <button
                            type="button"
                            onClick={() => msg.thinkingText && toggleThinking(msg.id)}
                            disabled={!msg.thinkingText}
                            className={`inline-flex items-center gap-1.5 text-muted-foreground transition-colors ${
                              msg.thinkingText ? "hover:text-foreground cursor-pointer" : "cursor-default"
                            }`}
                          >
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Thinking...</span>
                            {msg.thinkingText && (
                              <svg
                                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                                  expandedThinking.has(msg.id) ? "rotate-180" : ""
                                }`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            )}
                          </button>
                          {msg.thinkingText && expandedThinking.has(msg.id) && (
                            <div className="mt-2 ml-5 border-l-2 border-muted pl-3 py-1">
                              <p className="text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                                {msg.thinkingText}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                    {msg.role === "assistant" && ((msg.progress && msg.progress.length > 0) || (msg.executionTrace && msg.executionTrace.length > 0)) && (
                      <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                          Execution trace
                        </div>
                        <div className="space-y-1.5">
                          {msg.progress?.map((step, index) => (
                            <div key={`${msg.id}-progress-${index}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-[#6B358D]/70 dark:bg-[#F76D01]/70 shrink-0" />
                              <span>{step}</span>
                            </div>
                          ))}
                          {msg.executionTrace?.map((ev, index) => {
                            if (ev.kind === "step_start") {
                              return (
                                <div key={`${msg.id}-trace-${index}`} className="flex items-start gap-2 text-xs text-blue-600 dark:text-blue-400">
                                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                                  <span className="font-mono text-[11px]">▶ {ev.tool}</span>
                                </div>
                              );
                            }
                            if (ev.kind === "step_end") {
                              const ok = (ev.userErrorCount ?? 0) === 0;
                              return (
                                <div key={`${msg.id}-trace-${index}`} className={`flex items-start gap-2 text-xs ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                                  <span className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
                                  <span className="font-mono text-[11px]">
                                    {ok ? "✓" : "⚠"} {ev.tool} · {ev.elapsedMs}ms
                                    {ev.warnings && ev.warnings.length > 0 ? ` · ${ev.warnings.length} warning(s)` : ""}
                                  </span>
                                </div>
                              );
                            }
                            if (ev.kind === "reflection") {
                              const tone =
                                ev.decision === "stop" || ev.decision === "ask"
                                  ? "text-rose-600 dark:text-rose-400"
                                  : ev.decision === "retry"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground";
                              return (
                                <div key={`${msg.id}-trace-${index}`} className={`flex items-start gap-2 text-[11px] ${tone}`}>
                                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-current shrink-0 opacity-60" />
                                  <span className="italic">↪ {ev.decision}: {ev.rationale}</span>
                                </div>
                              );
                            }
                            return null;
                          })}
                        </div>
                      </div>
                    )}
                    {msg.role === "assistant" && msg.content && (
                      <>
                        <Separator className="my-3" />
                        <div className="rounded-lg border border-[#6B358D]/15 bg-[#400095]/5 px-3 py-2 dark:border-[#F76D01]/15 dark:bg-[#F76D01]/5">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B358D] dark:text-[#F76D01] mb-1">
                            Action summary
                          </div>
                          <StreamingMarkdown
                            text={msg.content}
                            messageId={msg.id}
                            animate={msg.id === lastMessageId}
                            onReveal={keepChatPinnedToBottom}
                            className="text-xs leading-relaxed text-foreground/90 break-words prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground [&_code]:text-[11px] [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded"
                          />
                        </div>
                      </>
                    )}
                    {msg.role === "assistant" && msg.actionReceipt && msg.actionReceipt.toolsExecuted.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {msg.actionReceipt.rowsAffected > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                            {msg.actionReceipt.rowsAffected} row{msg.actionReceipt.rowsAffected === 1 ? "" : "s"} affected
                          </span>
                        )}
                        {msg.actionReceipt.columnsAffected.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                            Columns: {msg.actionReceipt.columnsAffected.join(", ")}
                          </span>
                        )}
                        {msg.actionReceipt.sheetRowCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                            Sheet: {msg.actionReceipt.sheetRowCount} rows
                          </span>
                        )}
                        {msg.actionReceipt.toolsExecuted.map((tool, idx) => (
                          <span key={`${msg.id}-tool-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#400095]/10 text-[10px] font-medium text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
                            {TOOL_LABELS[tool] || tool}
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {msg.attachments.map((att) => (
                          <span
                            key={att.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-[10px] font-medium text-muted-foreground"
                          >
                            <Paperclip className="h-3 w-3" />
                            {att.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Intent Preview: Confirm/Cancel buttons */}
                    {msg.role === "assistant" && pendingPlan && msg === messages[messages.length - 1] && canEdit && (
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          size="sm"
                          className="h-7 px-3 text-xs gap-1.5 rounded-lg bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                          onClick={handleConfirmPlan}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                          Execute Plan
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-3 text-xs"
                          onClick={handleDismissPlan}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            {composerElement}
          </div>

          {/* Right: Sheet Workspace */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-muted/10">
            <div className="h-10 border-b bg-background/60 flex items-center px-4 gap-3 shrink-0">
              <span className="text-xs font-semibold text-muted-foreground">{resultsTitle}</span>
              {sheetViews.length > 0 && (
                <div className="flex items-center gap-1">
                  {sheetViews.map((view: SheetView) => (
                    <Button
                      key={view.key}
                      type="button"
                      size="sm"
                      variant={sheetView === view.key ? "secondary" : "ghost"}
                      className={`h-7 px-2.5 text-[11px] ${
                        sheetView === view.key
                          ? "bg-[#400095]/10 text-[#400095] dark:bg-[#F76D01]/10 dark:text-[#F76D01]"
                          : ""
                      }`}
                      onClick={() => {
                        setSheetView(view.key);
                        setColumnProfile(view.key);
                      }}
                    >
                      {view.label}
                    </Button>
                  ))}
                  {/* Entity-switch quick buttons — always accessible so the
                      user can jump between product and taxonomy sheets without
                      typing a full prompt. Routed through the agent so
                      server-side policy + tracing stay consistent. */}
                  {currentEntity === "products" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2.5 text-[11px] opacity-70 hover:opacity-100"
                      disabled={isStreaming || !canEdit}
                      onClick={() =>
                        void runAgent(taxonomyPrompt(integration?.provider), [])
                      }
                      title={`Switch to the ${taxonomyLabel(integration?.provider)} sheet`}
                    >
                      {taxonomyLabel(integration?.provider)} →
                    </Button>
                  )}
                  {currentEntity === "collections" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2.5 text-[11px] opacity-70 hover:opacity-100"
                      disabled={isStreaming || !canEdit}
                      onClick={() =>
                        void runAgent("اعرض كل المنتجات", [])
                      }
                      title="Switch to the Products sheet"
                    >
                      Products →
                    </Button>
                  )}
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                {remainingCount !== null && remainingCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px] gap-1"
                    onClick={handleContinueLoad}
                    disabled={isStreaming || !canEdit}
                    title="Load the next page of products from the connected store"
                  >
                    Continue (load more)
                  </Button>
                )}
                {originalSheet && resultRows.length < originalSheet.rows.length && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px] gap-1"
                    onClick={() => setSheet({ title: originalSheet.title, columns: originalSheet.columns, rows: originalSheet.rows })}
                    disabled={isStreaming}
                  >
                    Show all {originalSheet.rows.length} rows
                  </Button>
                )}
                {sheetHistory.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-[11px] gap-1"
                    onClick={handleUndo}
                    disabled={isStreaming || !canEdit}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Undo
                  </Button>
                )}
                {redoHistory.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-[11px] gap-1"
                    onClick={handleRedo}
                    disabled={isStreaming || !canEdit}
                  >
                    <Redo2 className="h-3.5 w-3.5" />
                    Redo
                  </Button>
                )}
                <SyncExportButton
                  columns={resultColumns}
                  rows={resultRows}
                  entity={currentEntity}
                  disabled={isStreaming || isApplying}
                />
                <Badge
                  variant={pendingChangeCount > 0 ? "default" : "secondary"}
                  className={`text-[10px] ${pendingChangeCount > 0 ? "bg-[#400095] text-white dark:bg-[#F76D01]" : ""}`}
                >
                  {pendingChangeCount > 0 ? `${pendingChangeCount} pending change${pendingChangeCount === 1 ? "" : "s"}` : "No pending changes"}
                </Badge>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="h-7 px-3 text-[11px]" disabled={pendingChangeCount === 0 || !canEdit}>
                      Review
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Review pending Sync changes</DialogTitle>
                      <DialogDescription>
                        Review the rows that will be prepared for CMS sync. This is a preview layer before the real apply endpoint is connected.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border bg-muted/20 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">New rows</div>
                          <div className="mt-1 text-sm font-semibold">{changeSummary.creates.length}</div>
                        </div>
                        <div className="rounded-lg border bg-muted/20 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Updated rows</div>
                          <div className="mt-1 text-sm font-semibold">{changeSummary.updates.length}</div>
                        </div>
                      </div>

                      {changeSummary.creates.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">New rows to create</div>
                          {changeSummary.creates.map((item) => (
                            <div key={`create-${item.rowIndex}`} className="rounded-lg border px-3 py-2">
                              <div className="text-xs font-semibold mb-1">
                                {String(item.row.title ?? item.row.handle ?? `Row ${item.rowIndex + 1}`)}
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                                {currentSheet?.columns.map((column) => (
                                  <div key={`create-${item.rowIndex}-${column}`}>
                                    <span className="font-medium text-foreground/80">{column}:</span>{" "}
                                    {String(item.row[column] ?? "—") || "—"}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {changeSummary.updates.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-muted-foreground">Updated rows</div>
                          {changeSummary.updates.map((item) => (
                            <div key={`update-${item.rowIndex}`} className="rounded-lg border px-3 py-2">
                              <div className="text-xs font-semibold mb-2">{item.label}</div>
                              <div className="space-y-2">
                                {item.changes.map((change) => (
                                  <div key={`update-${item.rowIndex}-${change.column}`} className="rounded-md bg-muted/30 px-2 py-1.5 text-[11px]">
                                    <div className="font-medium text-foreground/80 mb-1">{change.column}</div>
                                    <div className="text-muted-foreground">Before: {change.before || "—"}</div>
                                    <div className="text-foreground/90">After: {change.after || "—"}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {changeSummary.creates.length === 0 && changeSummary.updates.length === 0 && (
                        <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                          No pending Sync changes to review.
                        </div>
                      )}
                    </div>

                    <DialogFooter showCloseButton>
                      <Button
                        className="rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                        disabled={pendingChangeCount === 0 || isApplying || !canEdit}
                        onClick={handleApplySync}
                      >
                        {isApplying ? "Syncing..." : "Sync"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button
                  size="sm"
                  className="h-7 px-3 text-[11px] rounded-lg bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                  disabled={pendingChangeCount === 0 || isApplying || !canEdit}
                  onClick={handleApplySync}
                >
                  {isApplying ? "Syncing..." : "Sync"}
                </Button>
              </div>
            </div>
            {resultRows.length > 0 && resultColumns.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-auto p-4">
                {/* Filter bar: shown when a row filter is active */}
                {filteredRowIndexes && (
                  <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[#6B358D]/20 bg-[#400095]/5 px-3 py-2 text-xs dark:border-[#F76D01]/20 dark:bg-[#F76D01]/5">
                    <span className="text-[#6B358D] dark:text-[#F76D01] font-medium">
                      {filterDescription || "Filter active"} — showing {displayRows.length} of {resultRows.length} rows
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] text-[#6B358D] hover:text-[#6B358D]/80 dark:text-[#F76D01] dark:hover:text-[#F76D01]/80"
                      onClick={() => {
                        setFilteredRowIndexes(null);
                        setFilterDescription(null);
                        setCurrentPage(1);
                      }}
                    >
                      Clear filter
                    </Button>
                  </div>
                )}
                <div className="rounded-xl border bg-background overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {visibleColumns.map((column) => (
                          <TableHead key={column} className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {formatColumnLabel(column)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedRows.map((row, index) => (
                        <TableRow key={row.id ?? index}>
                          {visibleColumns.map((column) => (
                            <TableCell key={`${row.id ?? index}-${column}`} className="text-xs align-top max-w-[240px] whitespace-normal break-words">
                              {renderCellValue(column, row[column])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {displayRows.length > PAGE_SIZE && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      Showing {(safeCurrentPage - 1) * PAGE_SIZE + 1}-{Math.min(safeCurrentPage * PAGE_SIZE, displayRows.length)} of {displayRows.length} rows
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        disabled={safeCurrentPage <= 1}
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      >
                        Previous
                      </Button>
                      <span className="min-w-[84px] text-center text-[11px]">
                        Page {safeCurrentPage} of {totalPages}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        disabled={safeCurrentPage >= totalPages}
                        onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center space-y-4 max-w-sm">
                  <div className="mx-auto grid grid-cols-4 gap-px bg-border/40 rounded-lg overflow-hidden w-48">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div
                        key={i}
                        className={`h-6 ${
                          i < 4
                            ? "bg-muted/80"
                            : "bg-background/80"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-muted-foreground">
                      Results will appear here
                    </p>
                    <p className="text-xs text-muted-foreground/60 leading-relaxed">
                      Tables, synced records, and data operations will be displayed in this workspace
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Onboarding State (before first message) ──────────

  return (
    <div className="autommerce-dashboard flex-1 min-h-0 overflow-auto bg-background [font-family:var(--brand-font)]">
      {liveProgressWidget}
      <div className="relative min-h-full overflow-hidden">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-10">
          <div className="w-full max-w-4xl flex flex-col items-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="text-center space-y-4 mb-10 max-w-xl"
            >
              <div className="mx-auto h-14 w-14 rounded-2xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01] flex items-center justify-center mb-2">
                <Sparkles className="h-7 w-7" />
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em]">
                Sync
                <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                  Workspace
                </span>
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your AI-powered data operations center. Import, compare, transform, and sync your data — all through conversation.
              </p>
            </motion.div>

            <div className="grid grid-cols-2 gap-3 w-full max-w-2xl mb-8">
              {quickPrompts.map((qp, i) => (
                <motion.button
                  key={qp.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: i * 0.03 }}
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  disabled={!canEdit}
                  className="group flex items-start gap-3 p-3.5 rounded-xl border border-border/60 hover:border-[#6B358D]/40 hover:bg-[#400095]/5 dark:hover:border-[#F76D01]/40 dark:hover:bg-[#F76D01]/5 text-left transition-all disabled:pointer-events-none disabled:opacity-50"
                >
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-[#400095]/10 dark:group-hover:bg-[#F76D01]/10 transition-colors">
                    <qp.icon className="h-4 w-4 text-muted-foreground group-hover:text-[#6B358D] dark:group-hover:text-[#F76D01] transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold mb-0.5 flex items-center gap-1">
                      {qp.title}
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-[#6B358D]/60 dark:group-hover:text-[#F76D01]/60 transition-colors" />
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-snug">
                      {qp.description}
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>

            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/40 mb-8">
              <Store className="h-3.5 w-3.5 text-[#6B358D] dark:text-[#F76D01]" />
              <span className="text-xs font-medium">
                Connected: {integration.integration_name}
              </span>
              <Badge variant="secondary" className="text-[9px]">
                {integration.provider}
              </Badge>
            </div>

            <div className="w-full max-w-4xl rounded-2xl border bg-background/60 backdrop-blur-sm overflow-hidden">
              {composerElement}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

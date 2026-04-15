"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
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
  ArrowLeftRight,
  FileUp,
  Search,
  ListChecks,
  Table2,
  X,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Bot,
  User as UserIcon,
  ChevronRight,
  Settings,
  Unplug,
  Crown,
  AlertTriangle,
  Undo2,
  Redo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { getBalance } from "@/lib/credits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import ReactMarkdown from "react-markdown";
import { useWorkspaceContext } from "../layout";
import { useSyncStore, type SyncMessage, type SyncMode, type SyncWorkingMemory, type SyncActionReceipt } from "@/store/sync-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import { getWorkspaceIntegration, type WorkspaceIntegration } from "@/lib/supabase";

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

// Tools that are safe to auto-execute without user confirmation
const SAFE_AUTO_EXECUTE_TOOLS = new Set([
  "reply_only",
  "answer_question_about_sheet",
  "load_products_from_shopify",
  "analyze_attachments",
  "run_sheet_program",
  "research_with_web",
]);

const TOOL_LABELS: Record<string, string> = {
  load_products_from_shopify: "Load products from Shopify",
  append_row_from_ai: "Add a new row",
  write_sheet_column_with_ai: "Write/update column",
  search_images_with_serper: "Search images",
  delete_column: "Delete column",
  run_sheet_program: "Filter/analyze sheet",
  answer_question_about_sheet: "Answer question",
  reply_only: "Reply",
  research_with_web: "Web research",
  analyze_attachments: "Analyze attachments",
};

type SheetViewKey = "core" | "content" | "publishing" | "all";

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
]);

const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PDF_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function getAttachmentValidationError(file: File) {
  if (!SUPPORTED_ATTACHMENT_MIME_TYPES.has(file.type)) {
    return `The file format for ${file.name} is not supported right now. Only JPG, PNG, WEBP, BMP, and PDF are allowed.`;
  }

  const maxSize = file.type === "application/pdf" ? MAX_PDF_ATTACHMENT_BYTES : MAX_IMAGE_ATTACHMENT_BYTES;
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

const SHEET_VIEWS: Array<{ key: SheetViewKey; label: string; columns: string[] }> = [
  {
    key: "core",
    label: "Core",
    columns: ["title", "status", "vendor", "product_type", "tags", "price", "inventory_total", "primary_sku", "variant_count"],
  },
  {
    key: "content",
    label: "Content",
    columns: ["title", "body_html", "featured_image", "featured_image_alt_text", "seo_title", "seo_description", "tags"],
  },
  {
    key: "publishing",
    label: "Publishing",
    columns: ["title", "handle", "status", "published_at", "updated_at", "created_at"],
  },
  {
    key: "all",
    label: "All fields",
    columns: [],
  },
];

function formatColumnLabel(column: string) {
  return column.replaceAll("_", " ");
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

function renderCellValue(column: string, value: unknown) {
  const text = String(value ?? "").trim();

  if (!text) {
    return <span className="text-muted-foreground">—</span>;
  }

  if (column === "featured_image") {
    return (
      <div className="flex items-center gap-2 min-w-[140px]">
        <img src={text} alt="Product" className="h-10 w-10 rounded-md border object-cover bg-muted" />
        <div className="min-w-0 text-[11px] text-muted-foreground break-all">{truncateText(text, 42)}</div>
      </div>
    );
  }

  if (column === "body_html") {
    const preview = truncateText(stripHtml(text), 120);
    return <div className="max-w-[320px] leading-relaxed">{preview || "—"}</div>;
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

// ─── Quick Prompt Suggestions ────────────────────────────

const QUICK_PROMPTS = [
  {
    icon: Download,
    title: "Get products",
    description: "Load products from the connected platform",
    prompt: "Get all products from the connected platform into a new sheet",
  },
  {
    icon: ListChecks,
    title: "Show drafts",
    description: "Show draft products from the current platform data",
    prompt: "Show draft products from the current sheet",
  },
  {
    icon: Table2,
    title: "List brands",
    description: "Group products by vendor and count them",
    prompt: "List brands or vendors in the current sheet and count how many products each one has",
  },
  {
    icon: ArrowLeftRight,
    title: "Find products without images",
    description: "Show products that are missing a featured image",
    prompt: "Show products without images in the current sheet",
  },
  {
    icon: ListChecks,
    title: "Find incomplete items",
    description: "Detect products missing key catalog fields",
    prompt: "Show products in the current sheet that are missing important fields like image, description, vendor, or price",
  },
  {
    icon: FileUp,
    title: "Research a product",
    description: "Use Web mode to research official product details",
    prompt: "Research this product on the web and summarize the official details and key specifications",
  },
];

// ─── Main Page Component ─────────────────────────────────

export default function SyncPage() {
  const PAGE_SIZE = 50;
  const router = useRouter();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const basePath = `/w/${slug}`;
  const { workspace } = useWorkspaceContext();
  const invalidateCredits = useWorkspaceStore((s) => s.invalidateCredits);

  const {
    isFocusMode,
    setFocusMode,
    messages,
    addMessage,
    updateLastAssistantMessage,
    updateLastAssistantProgress,
    updateLastAssistantSessionSummary,
    isStreaming,
    setStreaming,
    mode,
    setMode,
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
  const [currentPage, setCurrentPage] = useState(1);
  const [chatBlockedReason, setChatBlockedReason] = useState<"NO_CREDITS" | "NO_SUBSCRIPTION" | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PendingPlanInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  const visibleColumns = (() => {
    const activeView = SHEET_VIEWS.find((view) => view.key === sheetView);
    if (!activeView || activeView.key === "all") {
      return resultColumns;
    }

    const scopedColumns = activeView.columns.filter((column) => resultColumns.includes(column));
    return scopedColumns.length > 0 ? scopedColumns : resultColumns;
  })();

  const totalPages = Math.max(1, Math.ceil(resultRows.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedRows = resultRows.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE);

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

  const sessionSummary = messages
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  const handleApplySync = useCallback(async () => {
    if (!workspace?.id || !integration || !currentSheet || pendingChangeCount === 0 || isApplying) {
      return;
    }

    setIsApplying(true);

    try {
      const res = await fetch("/api/sync/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          creates: changeSummary.creates.map((item) => item.row),
          updates: changeSummary.updates
            .filter((item) => item.productId)
            .map((item) => ({
              productId: item.productId,
              row: item.row,
              changedColumns: item.changes.map((change) => change.column),
            })),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to sync changes");
      }

      if ((data?.errorCount ?? 0) > 0) {
        const backendErrors = Array.isArray(data?.errors) ? data.errors.filter(Boolean) : [];
        const detail = backendErrors.length > 0 ? `\n\n${backendErrors.join("\n")}` : "";
        throw new Error((data?.message || "Sync completed with errors.") + detail);
      }

      setOriginalAndWorkingSheet(currentSheet);
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.message || "Sync completed successfully.",
        timestamp: Date.now(),
        progress: ["Prepared reviewed changes", "Applied changes to Shopify", "Kept the current sheet view in place"],
      });
    } catch (error: any) {
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `⚠️ ${error?.message || "Failed to sync changes"}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsApplying(false);
    }
  }, [addMessage, changeSummary.creates, changeSummary.updates, currentSheet, integration, isApplying, pendingChangeCount, setOriginalAndWorkingSheet, workspace?.id]);

  const processAgentStream = useCallback(
    async (response: Response) => {
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
            | { type: "progress"; progress: string[] }
            | {
                type: "result";
                data: {
                  assistantMessage?: string;
                  progress?: string[];
                  sessionSummary?: string;
                  sheet?: SyncSheet;
                  executedSteps?: Array<{ tool: string }>;
                  workingMemory?: AgentWorkingMemoryPayload;
                  actionReceipt?: SyncActionReceipt;
                };
              }
            | { type: "error"; error: string };

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
              const loadedFreshSource = Array.isArray(event.data?.executedSteps)
                ? event.data.executedSteps.some((step) => step.tool === "load_products_from_shopify")
                : false;

              // Push current sheet as snapshot before replacing (for undo)
              if (resultColumns.length > 0 || resultRows.length > 0) {
                pushSheetSnapshot({
                  title: resultsTitle,
                  columns: resultColumns,
                  rows: resultRows,
                });
              }

              if (loadedFreshSource || !originalSheet) {
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

            if (event.data?.workingMemory) {
              setWorkingMemory(event.data.workingMemory);
            }

            if (event.data?.actionReceipt) {
              updateLastAssistantActionReceipt(event.data.actionReceipt);
            }

            updateLastAssistantMessage(event.data?.assistantMessage || "Done.");
            continue;
          }

          if (event.type === "error") {
            updateLastAssistantMessage(`⚠️ ${event.error}`);
          }
        }
      }
    },
    [originalSheet, setOriginalAndWorkingSheet, setSheet, setWorkingMemory, updateLastAssistantMessage, updateLastAssistantProgress, updateLastAssistantSessionSummary, updateLastAssistantActionReceipt, pushSheetSnapshot, resultColumns, resultRows, resultsTitle]
  );

  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreaming(false);
    updateLastAssistantProgress([]);
    updateLastAssistantMessage("Stopped.");
  }, [setStreaming, updateLastAssistantMessage, updateLastAssistantProgress]);

  const handleUndo = useCallback(() => {
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
  }, [currentSheet, pushRedoSnapshot, undoSheet, setSheet]);

  const handleRedo = useCallback(() => {
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
  }, [currentSheet, pushSheetSnapshot, redoSheet, setSheet]);

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

    return () => {
      resetChat();
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
    [addPendingAttachment]
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
      mode,
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
      workingMemory,
      ...extra,
    }),
    [workspace?.id, messages, sessionSummary, mode, webEnabled, integration, currentSheet, workingMemory]
  );

  // Execute an approved plan (either auto-approved or user-confirmed)
  const executeApprovedPlan = useCallback(
    async (trimmed: string, attachmentPayloads: SyncAttachmentPayload[], plan: AgentPlan) => {
      setStreaming(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch("/api/sync/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(buildAgentRequestBody(trimmed, attachmentPayloads, { preApprovedPlan: plan })),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed to get response" }));

          if (res.status === 402) {
            const errorCode = err?.error === "NO_SUBSCRIPTION" ? "NO_SUBSCRIPTION" : "NO_CREDITS";
            setChatBlockedReason(errorCode);
            updateLastAssistantMessage("");
            updateLastAssistantProgress([]);
            return;
          }

          updateLastAssistantMessage(`⚠️ ${err.error || "Something went wrong"}`);
          return;
        }

        await processAgentStream(res);
        invalidateCredits();
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        updateLastAssistantMessage(`⚠️ ${err?.message || "Network error"}`);
      } finally {
        abortControllerRef.current = null;
        setStreaming(false);
      }
    },
    [buildAgentRequestBody, processAgentStream, invalidateCredits, setStreaming, updateLastAssistantMessage, updateLastAssistantProgress]
  );

  const handleSend = useCallback(async () => {
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

    setStreaming(true);

    try {
      // Phase 1: Get the plan first
      updateLastAssistantProgress(["Planning steps..."]);
      const planRes = await fetch("/api/sync/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAgentRequestBody(trimmed, attachmentPayloads, { planOnly: true })),
      });

      if (!planRes.ok) {
        const err = await planRes.json().catch(() => ({ error: "Failed to get response" }));
        if (planRes.status === 402) {
          setChatBlockedReason(err?.error === "NO_SUBSCRIPTION" ? "NO_SUBSCRIPTION" : "NO_CREDITS");
          updateLastAssistantMessage("");
          updateLastAssistantProgress([]);
          return;
        }
        updateLastAssistantMessage(`⚠️ ${err.error || "Something went wrong"}`);
        return;
      }

      const { plan, estimatedCredits } = (await planRes.json()) as { plan: AgentPlan; estimatedCredits?: number };

      if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        updateLastAssistantMessage(plan?.assistantMessage || "I couldn't determine what to do. Could you rephrase?");
        return;
      }

      // Phase 2: Decide whether to auto-execute or ask for confirmation
      const allSafe = plan.steps.every((step) => SAFE_AUTO_EXECUTE_TOOLS.has(step.tool));

      if (allSafe) {
        // Auto-execute safe operations
        updateLastAssistantProgress(["Executing plan..."]);
        await executeApprovedPlan(trimmed, attachmentPayloads, plan);
      } else {
        // Show intent preview for confirmation
        setPendingPlan({ plan, userMessage: trimmed, attachmentPayloads, estimatedCredits });
        const stepLabels = plan.steps.map((s) => TOOL_LABELS[s.tool] || s.tool).join(" → ");
        updateLastAssistantMessage(
          `📋 **Plan preview:**\n${plan.assistantMessage || ""}\n\nSteps: ${stepLabels}\n\n_Waiting for your confirmation to proceed._`
        );
        updateLastAssistantProgress([]);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      updateLastAssistantMessage(`⚠️ ${err?.message || "Network error"}`);
    } finally {
      if (!pendingPlan) {
        setStreaming(false);
      }
    }
  }, [
    chatBlockedReason,
    input,
    pendingAttachments,
    isStreaming,
    mode,
    workspace?.id,
    addMessage,
    updateLastAssistantMessage,
    updateLastAssistantProgress,
    setStreaming,
    clearPendingAttachments,
    buildAgentRequestBody,
    executeApprovedPlan,
    pendingPlan,
  ]);

  // User confirms the pending plan
  const handleConfirmPlan = useCallback(async () => {
    if (!pendingPlan) return;
    const { plan, userMessage, attachmentPayloads } = pendingPlan;
    setPendingPlan(null);
    updateLastAssistantMessage("");
    updateLastAssistantProgress(["Executing approved plan..."]);
    await executeApprovedPlan(userMessage, attachmentPayloads, plan);
  }, [pendingPlan, executeApprovedPlan, updateLastAssistantMessage, updateLastAssistantProgress]);

  // User dismisses the pending plan
  const handleDismissPlan = useCallback(() => {
    setPendingPlan(null);
    setStreaming(false);
    updateLastAssistantMessage("Plan cancelled.");
    updateLastAssistantProgress([]);
  }, [setStreaming, updateLastAssistantMessage, updateLastAssistantProgress]);

  // Handle quick prompt click
  const handleQuickPrompt = useCallback(
    (prompt: string) => {
      setInput(prompt);
      textareaRef.current?.focus();
    },
    []
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
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading Sync workspace...</p>
        </div>
      </div>
    );
  }

  if (!integration) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-muted/60 flex items-center justify-center">
            <Unplug className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Integration Required</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect a platform in Settings to start using Sync. Once connected, you can
              import, compare, and manage your data with AI.
            </p>
          </div>
          <Button onClick={() => router.push(`${basePath}/settings`)} className="gap-2">
            <Settings className="h-4 w-4" />
            Go to Settings
          </Button>
        </div>
      </div>
    );
  }

  // ─── Composer (shared between onboarding and focused) ──

  const composerElement = (
    <div className="border-t bg-background p-3">
      <Dialog open={!!chatBlockedReason} onOpenChange={(open) => !open && setChatBlockedReason(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {chatBlockedReason === "NO_SUBSCRIPTION" ? (
                <Crown className="h-4 w-4 text-primary" />
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
            placeholder="Describe what you want to do..."
            rows={1}
            disabled={isStreaming || !!chatBlockedReason}
            className="w-full resize-none rounded-xl border bg-muted/30 px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 disabled:opacity-50 transition-all"
            style={{ maxHeight: 200 }}
          />
        </div>

        <Button
          size="icon"
          onClick={isStreaming ? handleStopStreaming : handleSend}
          disabled={!!chatBlockedReason || (!isStreaming && !input.trim() && pendingAttachments.length === 0)}
          className="h-10 w-10 rounded-xl shrink-0"
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
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="Upload files"
        >
          <Paperclip className="h-3.5 w-3.5" />
          Upload
        </button>

        <button
          onClick={toggleWebEnabled}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            webEnabled
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          title="Connect to web"
        >
          <Globe className="h-3.5 w-3.5" />
          Web
        </button>

        <div className="flex items-center bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setMode("fast")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
              mode === "fast"
                ? "bg-background shadow-sm text-foreground"
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
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            Pro
          </button>
        </div>

        <div className="flex-1" />

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
      <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
        {/* Split Workspace */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left: Chat Panel */}
          <div className="w-[460px] min-w-[360px] border-r flex flex-col min-h-0 overflow-hidden bg-background">
            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-3">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      msg.role === "user"
                        ? "bg-primary/10"
                        : "bg-muted"
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
                    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {msg.role === "user" ? (
                        msg.content
                      ) : msg.content ? null : (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Thinking...
                        </span>
                      )}
                    </div>
                    {msg.role === "assistant" && msg.progress && msg.progress.length > 0 && (
                      <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                          Execution trace
                        </div>
                        <div className="space-y-1.5">
                          {msg.progress.map((step, index) => (
                            <div key={`${msg.id}-progress-${index}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary/70 shrink-0" />
                              <span>{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {msg.role === "assistant" && msg.content && (
                      <>
                        <Separator className="my-3" />
                        <div className="rounded-lg border border-primary/10 bg-primary/5 px-3 py-2">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-primary/80 mb-1">
                            Action summary
                          </div>
                          <div className="text-xs leading-relaxed text-foreground/90 break-words prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground [&_code]:text-[11px] [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
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
                          <span key={`${msg.id}-tool-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-[10px] font-medium text-primary/70">
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
                    {msg.role === "assistant" && pendingPlan && msg === messages[messages.length - 1] && (
                      <div className="mt-3 flex items-center gap-2">
                        <Button
                          size="sm"
                          className="h-7 px-3 text-xs gap-1.5"
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
              {resultColumns.length > 0 && (
                <div className="flex items-center gap-1">
                  {SHEET_VIEWS.map((view) => (
                    <Button
                      key={view.key}
                      type="button"
                      size="sm"
                      variant={sheetView === view.key ? "secondary" : "ghost"}
                      className="h-7 px-2.5 text-[11px]"
                      onClick={() => setSheetView(view.key)}
                    >
                      {view.label}
                    </Button>
                  ))}
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
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
                    disabled={isStreaming}
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
                    disabled={isStreaming}
                  >
                    <Redo2 className="h-3.5 w-3.5" />
                    Redo
                  </Button>
                )}
                <Badge variant={pendingChangeCount > 0 ? "default" : "secondary"} className="text-[10px]">
                  {pendingChangeCount > 0 ? `${pendingChangeCount} pending change${pendingChangeCount === 1 ? "" : "s"}` : "No pending changes"}
                </Badge>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="h-7 px-3 text-[11px]" disabled={pendingChangeCount === 0}>
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
                      <Button disabled={pendingChangeCount === 0 || isApplying} onClick={handleApplySync}>
                        {isApplying ? "Syncing..." : "Sync"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button size="sm" className="h-7 px-3 text-[11px]" disabled={pendingChangeCount === 0 || isApplying} onClick={handleApplySync}>
                  {isApplying ? "Syncing..." : "Sync"}
                </Button>
              </div>
            </div>
            {resultRows.length > 0 && resultColumns.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-auto p-4">
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
                {resultRows.length > PAGE_SIZE && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      Showing {(safeCurrentPage - 1) * PAGE_SIZE + 1}-{Math.min(safeCurrentPage * PAGE_SIZE, resultRows.length)} of {resultRows.length} rows
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
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-4xl flex flex-col items-center">
          <div className="text-center space-y-4 mb-10 max-w-xl">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-2">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Sync Workspace</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your AI-powered data operations center. Import, compare, transform, and sync your data — all through conversation.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 w-full max-w-2xl mb-8">
            {QUICK_PROMPTS.map((qp) => (
              <button
                key={qp.title}
                onClick={() => handleQuickPrompt(qp.prompt)}
                className="group flex items-start gap-3 p-3.5 rounded-xl border border-border/60 hover:border-primary/30 hover:bg-primary/5 text-left transition-all"
              >
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                  <qp.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold mb-0.5 flex items-center gap-1">
                    {qp.title}
                    <ChevronRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug">
                    {qp.description}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/40 mb-8">
            <Store className="h-3.5 w-3.5 text-primary" />
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
  );
}

import { NextRequest, NextResponse } from "next/server";
import {
  extractDownloadQuerySchema,
  jsonError,
  requireMrRead,
} from "@/lib/market-research/api-schema";
import { getMrProject } from "@/lib/market-research/server-persist";
import { loadExtractRowsAdmin } from "@/lib/market-research/storage-admin";
import type { KeywordRow } from "@/lib/market-research/providers/keyword-provider";

export const maxDuration = 60;

const CSV_COLUMNS = [
  "keyword",
  "seed",
  "volume",
  "cpc_usd",
  "difficulty",
  "competition",
  "results",
  "intents",
  "database",
] as const;

function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: KeywordRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.phrase),
        csvCell(row.seed),
        csvCell(row.volume),
        csvCell(row.cpc),
        csvCell(row.difficulty),
        csvCell(row.competitionLevel),
        csvCell(row.results),
        csvCell(Array.isArray(row.intents) ? row.intents.join(" | ") : ""),
        csvCell(row.database),
      ].join(",")
    );
  }
  // Excel needs the BOM to read UTF-8 keywords correctly.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function safeFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "market-research";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = extractDownloadQuerySchema.safeParse({
    workspaceId: params.get("workspaceId") ?? undefined,
    projectId: params.get("projectId") ?? undefined,
    extractId: params.get("extractId") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError("Invalid download request", 400);
  }

  const auth = await requireMrRead(parsed.data.workspaceId);
  if (!auth.ok) return auth.response;

  try {
    const project = await getMrProject(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId
    );
    if (!project) return jsonError("Project not found", 404);

    const rows = await loadExtractRowsAdmin(
      auth.admin,
      parsed.data.workspaceId,
      parsed.data.projectId,
      parsed.data.extractId
    );
    if (rows.length === 0) {
      return jsonError("No archived keywords found for this project", 404);
    }

    const fileName = `${safeFileName(project.name ?? "project")}-keywords-${rows.length}.csv`;
    return new NextResponse(toCsv(rows), {
      headers: {
        ...auth.headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(rows.length),
      },
    });
  } catch (err) {
    console.error("[api/market-research/extract/download] Error:", err);
    return jsonError("Failed to build keyword export", 500);
  }
}

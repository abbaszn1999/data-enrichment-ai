import { NextRequest, NextResponse } from "next/server";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import {
  loadVisualizerWorksheetMatchingRevisionAdmin,
  signVisualizerWorksheetImages,
} from "@/lib/visualizer/storage-admin";
import { buildVisualizerResultsTable } from "@/lib/visualizer/results-xlsx";
import {
  resolveVisualizerHtmlImages,
  stripUnfilledVisualizerMarkers,
} from "@/lib/visualizer/html-embed";
import { applyVisualizerProjectSettings } from "@/lib/visualizer/types";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import { visualizerWarn } from "@/lib/visualizer/log";
import {
  parseTableExportOptions,
  selectTableColumns,
  serializeTableExport,
  type TableExportOptions,
} from "@/lib/export/table-file";
import { deliverExportFile } from "@/lib/export/deliver";
import {
  parseTablePlatformOptions,
  serializeTablePlatformExport,
  type TablePlatformOptions,
} from "@/lib/export/table-platform";
import {
  DESCRIPTION_IMAGES_FIELD,
  SHOPIFY_FILES_SETTING,
  shopifyFilesPrefix,
} from "@/lib/catalog/platforms/shopify-description";
import {
  MAGENTO_UPLOAD_SETTING,
  PICTURES_README,
  WOOCOMMERCE_UPLOAD_SETTING,
  uploadedPicturesFolder,
} from "@/lib/catalog/platforms/description-uploads";
import {
  DESCRIPTION_IMAGES_HEADER,
  SHOPIFY_FILES_README,
  buildDescriptionPicturesZip,
  descriptionFileLinks,
  prepareShopifyDescriptionImages,
  withDescriptionImagesColumn,
} from "@/lib/visualizer/shopify-export";
import { getVisualizerPrefix } from "@/lib/visualizer/storage-paths";

export const maxDuration = 120;

type Ctx = { params: Promise<{ sessionId: string }> };

/**
 * Store folder the description's pictures will live in, from the link the user
 * pasted: Shopify's Files folder is known before upload, WooCommerce and
 * Magento folders only from a picture already uploaded (description-uploads.ts).
 */
function descriptionPicturesFolder(options: TablePlatformOptions): string | null {
  if (options.platform === "shopify") return shopifyFilesPrefix(options.settings[SHOPIFY_FILES_SETTING] ?? "");
  const setting = options.platform === "woocommerce" ? WOOCOMMERCE_UPLOAD_SETTING : MAGENTO_UPLOAD_SETTING;
  return uploadedPicturesFolder(options.settings[setting] ?? "");
}

/** Visualizer store exports: Shopify has every mode, WooCommerce and Magento the two upload steps. */
function supportedVisualizerExport(options: TablePlatformOptions): boolean {
  return options.platform === "shopify"
    ? options.mode !== "pictures"
    : options.mode === "pictures" || options.mode === "description";
}

async function exportVisualizerWorkbook(
  request: NextRequest,
  sessionId: string,
  workspaceId: string,
  options: TableExportOptions = { format: "xlsx" },
  redirect = false,
  platformOptions: TablePlatformOptions | null = null
) {
  const auth = await requireVisualizerAuth({ workspaceId });
  if (!auth.ok) return auth.response;

  const picturesOnly = platformOptions?.mode === "pictures";
  const filesPrefix = platformOptions && !picturesOnly ? descriptionPicturesFolder(platformOptions) : null;
  if (platformOptions && (!supportedVisualizerExport(platformOptions) || (!picturesOnly && !filesPrefix))) {
    return NextResponse.json(
      {
        error: !supportedVisualizerExport(platformOptions)
          ? "This export is not available for Visualizer"
          : "Paste a picture link from your store",
      },
      { status: 400, headers: auth.headers }
    );
  }

  const { data: session, error } = await auth.admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !session) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: auth.headers }
    );
  }

  const worksheet = await loadVisualizerWorksheetMatchingRevisionAdmin(
    workspaceId,
    sessionId,
    Number(session.worksheet_revision ?? 0)
  );
  if (!worksheet) {
    return NextResponse.json(
      { error: "Worksheet is synchronizing; retry shortly" },
      { status: 409, headers: { ...auth.headers, "Retry-After": "2" } }
    );
  }

  let settings;
  try {
    settings = parseVisualizerProjectSettings(session.settings);
  } catch {
    settings = worksheet.settings;
  }
  const hydrated = applyVisualizerProjectSettings(worksheet, settings);
  // Only the exported rows need image links; headers still come from the full sheet.
  const exportRows = options.rowIds
    ? hydrated.rows.filter((row) => options.rowIds!.has(row.id))
    : hydrated.rows;

  if (platformOptions) {
    const { platform, mode } = platformOptions;
    const safeName = String(session.name || "visualizer").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    const deliver = (buffer: Buffer, contentType: string, extension: string) =>
      deliverExportFile({
        admin: auth.admin,
        path: `${getVisualizerPrefix(workspaceId, sessionId)}/exports/${Date.now()}.${extension}`,
        buffer,
        contentType,
        fileName: `${safeName}-${platform}-${mode}.${extension}`,
        headers: auth.headers,
        onStorageError: (message) =>
          visualizerWarn("export", "Export storage failed; sending file inline", { error: message }),
      });

    // Step 1 for WooCommerce and Magento: just the pictures, to upload first.
    if (picturesOnly && platform !== "shopify") {
      const buffer = await buildDescriptionPicturesZip({
        admin: auth.admin,
        rows: exportRows,
        readme: PICTURES_README[platform],
      });
      return deliver(buffer, "application/zip", "zip");
    }

    // Shopify downloads the pictures itself when they are listed as product
    // images; every other route has them uploaded by hand to a known folder.
    const viaProductImages = platform === "shopify" && mode !== "description_files";
    const { cdnByPath, signedByPath } = viaProductImages
      ? await prepareShopifyDescriptionImages({
          admin: auth.admin,
          workspaceId,
          sessionId,
          rows: exportRows,
          filesPrefix: filesPrefix!,
        })
      : { cdnByPath: descriptionFileLinks(exportRows, filesPrefix!), signedByPath: {} as Record<string, string> };
    const described = {
      ...hydrated,
      rows: hydrated.rows.map((row) =>
        row.generatedDescription
          ? {
              ...row,
              generatedDescription: stripUnfilledVisualizerMarkers(
                resolveVisualizerHtmlImages(row.generatedDescription, cdnByPath)
              ),
            }
          : row
      ),
    };
    const table = withDescriptionImagesColumn(
      buildVisualizerResultsTable(described, signedByPath, options.rowIds),
      exportRows,
      signedByPath
    );
    const imageField = mode === "description" ? DESCRIPTION_IMAGES_FIELD : "Product image URL";
    const exported = await serializeTablePlatformExport(table, {
      ...platformOptions,
      mapping: viaProductImages
        ? { ...platformOptions.mapping, [imageField]: DESCRIPTION_IMAGES_HEADER }
        : platformOptions.mapping,
    });
    if (platform === "shopify" && mode === "description_files") {
      const buffer = await buildDescriptionPicturesZip({
        admin: auth.admin,
        rows: exportRows,
        readme: SHOPIFY_FILES_README,
        csv: { name: "shopify-products.csv", content: exported.buffer.toString("utf8") },
      });
      return deliver(buffer, "application/zip", "zip");
    }
    return deliver(exported.buffer, exported.contentType, exported.extension);
  }

  // Signing is best-effort: export must still succeed with raw HTML if Storage is flaky.
  const signedUrls = await signVisualizerWorksheetImages(
    { ...hydrated, rows: exportRows },
    60 * 60 * 24 * 7
  ).catch((signError) => {
    visualizerWarn("export", "Could not sign image URLs for export", {
      error:
        signError instanceof Error ? signError.message : String(signError),
    });
    return {} as Record<string, string>;
  });

  const resolvedById = new Map(
    exportRows.map((row) => [
      row.id,
      row.generatedDescription
        ? stripUnfilledVisualizerMarkers(
            resolveVisualizerHtmlImages(row.generatedDescription, signedUrls)
          )
        : row.generatedDescription,
    ])
  );
  const resolved = {
    ...hydrated,
    rows: hydrated.rows.map((row) =>
      resolvedById.has(row.id)
        ? { ...row, generatedDescription: resolvedById.get(row.id) }
        : row
    ),
  };

  const { buffer, contentType, extension } = await serializeTableExport(
    selectTableColumns(
      buildVisualizerResultsTable(resolved, signedUrls, options.rowIds),
      options.columns
    ),
    options.format
  );
  const safeName = String(session.name || "visualizer")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);

  return deliverExportFile({
    admin: auth.admin,
    path: `${getVisualizerPrefix(workspaceId, sessionId)}/exports/${Date.now()}.${extension}`,
    buffer,
    contentType,
    fileName: `${safeName}-results.${extension}`,
    headers: auth.headers,
    redirect,
    onStorageError: (message) =>
      visualizerWarn("export", "Export storage failed; sending file inline", { error: message }),
  });
}

/**
 * POST /api/visualizer/sessions/[sessionId]/export
 * { workspaceId, format?: "xlsx" | "csv" | "json", rowIds?: string[], columns?: string[] }
 * With { platform: "shopify", mode, mapping, settings: { shopifyFilesUrl } } it
 * returns a Shopify CSV whose descriptions point at Shopify's own CDN.
 */
export async function POST(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  let body: {
    workspaceId?: string;
    format?: unknown;
    rowIds?: unknown;
    columns?: unknown;
    platform?: unknown;
    mode?: unknown;
    mapping?: unknown;
    settings?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceId = body.workspaceId;
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }
  return exportVisualizerWorkbook(
    request,
    sessionId,
    workspaceId,
    parseTableExportOptions(body),
    false,
    parseTablePlatformOptions(body)
  );
}

/** GET kept for compatibility; prefer POST + blob download like Gallery. */
export async function GET(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }
  return exportVisualizerWorkbook(request, sessionId, workspaceId, { format: "xlsx" }, true);
}

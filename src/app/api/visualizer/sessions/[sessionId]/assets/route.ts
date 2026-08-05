import { NextRequest, NextResponse } from "next/server";
import { imageSize } from "image-size";
import { requireVisualizerAuth } from "@/lib/visualizer/auth";
import {
  createVisualizerSignedUrlsAdmin,
  removeVisualizerPathsAdmin,
  uploadVisualizerBytesAdmin,
} from "@/lib/visualizer/storage-admin";
import { getVisualizerAiAssetPath } from "@/lib/visualizer/storage-paths";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import type {
  VisualizerProjectSettings,
  VisualizerSession,
} from "@/lib/visualizer/types";

type Ctx = { params: Promise<{ sessionId: string }> };
type AssetKind = "logo" | "brandGuide";
type AssetSetting = "logoPath" | "brandGuidePath";

const KIND_CONFIG: Record<
  AssetKind,
  {
    pathKind: "logo" | "brand-guide";
    setting: AssetSetting;
  }
> = {
  logo: { pathKind: "logo", setting: "logoPath" },
  brandGuide: { pathKind: "brand-guide", setting: "brandGuidePath" },
};

const CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function authorizeSession(sessionId: string, workspaceId: string) {
  const auth = await requireVisualizerAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return { response: auth.response } as const;
  const { data: session, error } = await auth.admin
    .from("visualizer_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !session) {
    return {
      response: NextResponse.json(
        { error: "Visualizer session not found" },
        { status: 404, headers: auth.headers }
      ),
    } as const;
  }
  if (session.status === "processing") {
    return {
      response: NextResponse.json(
        { error: "Reference assets cannot be changed during generation" },
        { status: 409, headers: auth.headers }
      ),
    } as const;
  }
  return { auth, session: session as VisualizerSession } as const;
}

function readStoredSettings(raw: unknown): VisualizerProjectSettings {
  return parseVisualizerProjectSettings(raw ?? {});
}

async function updateAssetSetting(params: {
  auth: Extract<Awaited<ReturnType<typeof authorizeSession>>, { auth: unknown }>["auth"];
  workspaceId: string;
  sessionId: string;
  setting: AssetSetting;
  path: string | null;
  /** When provided, replaces settings (then applies the asset path). Keeps UI and DB aligned. */
  clientSettings?: VisualizerProjectSettings | null;
}): Promise<{ session: VisualizerSession; settings: VisualizerProjectSettings }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: current, error: readError } = await params.auth.admin
      .from("visualizer_sessions")
      .select("*")
      .eq("id", params.sessionId)
      .eq("workspace_id", params.workspaceId)
      .single();
    if (readError || !current) {
      throw new Error(readError?.message || "Visualizer session not found");
    }

    let settings = params.clientSettings
      ? parseVisualizerProjectSettings(params.clientSettings)
      : readStoredSettings(current.settings);

    settings = {
      ...settings,
      images: {
        ...settings.images,
        [params.setting]: params.path,
        ...(params.path ? { brandingEnabled: true } : {}),
      },
    };

    const { data: nextRevision, error: saveError } = await params.auth.admin.rpc(
      "save_visualizer_session_settings",
      {
        p_session_id: params.sessionId,
        p_workspace_id: params.workspaceId,
        p_expected_revision: Number(current.settings_revision ?? 0),
        p_settings: settings,
      }
    );
    if (saveError) throw saveError;
    if (nextRevision === null || nextRevision === undefined) continue;

    return {
      session: {
        ...(current as VisualizerSession),
        settings,
        settings_revision: Number(nextRevision),
      },
      settings,
    };
  }
  throw new Error("Settings changed in another tab; retry the upload");
}

function parseClientSettings(raw: unknown): VisualizerProjectSettings | null {
  if (raw == null || raw === "") return null;
  try {
    const value =
      typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    return parseVisualizerProjectSettings(value);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const form = await request.formData().catch(() => null);
  const workspaceId = String(form?.get("workspaceId") || "");
  const kind = String(form?.get("kind") || "") as AssetKind;
  const file = form?.get("file");
  const clientSettings = parseClientSettings(form?.get("settings"));
  if (!workspaceId || !KIND_CONFIG[kind] || !(file instanceof File)) {
    return NextResponse.json(
      { error: "workspaceId, kind, and image file are required" },
      { status: 400 }
    );
  }
  const ext = CONTENT_TYPES[file.type];
  if (!ext || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Use a JPEG, PNG, or WebP image up to 10 MB" },
      { status: 400 }
    );
  }

  const loaded = await authorizeSession(sessionId, workspaceId);
  if ("response" in loaded) return loaded.response;
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const dimensions = imageSize(buffer);
    const width = dimensions.width || 0;
    const height = dimensions.height || 0;
    if (!width || !height || width * height > 60_000_000) {
      throw new Error("Invalid image dimensions");
    }
  } catch {
    return NextResponse.json(
      { error: "The uploaded file is not a valid supported image" },
      { status: 400, headers: loaded.auth.headers }
    );
  }

  const config = KIND_CONFIG[kind];
  const stored = readStoredSettings(loaded.session.settings);
  const previousPath = stored.images[config.setting] ?? null;
  const path = getVisualizerAiAssetPath(
    workspaceId,
    sessionId,
    config.pathKind,
    ext
  );
  try {
    await uploadVisualizerBytesAdmin(path, buffer, file.type, { upsert: true });
    const updated = await updateAssetSetting({
      auth: loaded.auth,
      workspaceId,
      sessionId,
      setting: config.setting,
      path,
      clientSettings,
    });
    if (previousPath && previousPath !== path) {
      await removeVisualizerPathsAdmin([previousPath]).catch(() => undefined);
    }
    return NextResponse.json(
      {
        ...updated,
        path,
        signedUrls: await createVisualizerSignedUrlsAdmin([path]),
      },
      { headers: loaded.auth.headers }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json(
      { error: message },
      {
        status: /another tab|not initialized/i.test(message) ? 409 : 500,
        headers: loaded.auth.headers,
      }
    );
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const { sessionId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
    kind?: AssetKind;
    settings?: unknown;
  } | null;
  const workspaceId = String(body?.workspaceId || "");
  const kind = body?.kind;
  const clientSettings = parseClientSettings(body?.settings);
  if (!workspaceId || !kind || !KIND_CONFIG[kind]) {
    return NextResponse.json(
      { error: "workspaceId and a valid kind are required" },
      { status: 400 }
    );
  }

  const loaded = await authorizeSession(sessionId, workspaceId);
  if ("response" in loaded) return loaded.response;
  const setting = KIND_CONFIG[kind].setting;
  const stored = readStoredSettings(loaded.session.settings);
  const previousPath = stored.images[setting] ?? null;
  try {
    const updated = await updateAssetSetting({
      auth: loaded.auth,
      workspaceId,
      sessionId,
      setting,
      path: null,
      clientSettings,
    });
    if (previousPath) {
      await removeVisualizerPathsAdmin([previousPath]).catch(() => undefined);
    }
    return NextResponse.json(
      { ...updated, signedUrls: {} },
      { headers: loaded.auth.headers }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not remove image";
    return NextResponse.json(
      { error: message },
      {
        status: /another tab|not initialized/i.test(message) ? 409 : 500,
        headers: loaded.auth.headers,
      }
    );
  }
}

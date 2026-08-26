// First-time header generation: vision (brief) → competitor research → code
// generation, streamed as NDJSON so the progress trace is honest about which
// of the three calls is running. Edits after this initial build go through
// /api/website-restructure/chat instead.

import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireWrAuth } from "@/lib/website-restructure/auth";
import { buildBodySchema, jsonError } from "@/lib/website-restructure/api-schema";
import {
  getWrProjectRow,
  releaseWrProjectBuild,
  tryLeaseWrProjectBuild,
} from "@/lib/website-restructure/server-persist";
import {
  loadWrTaxonomyAdmin,
  saveWrGenerationContextAdmin,
  saveWrVersionAdmin,
  WR_STORAGE_BUCKET,
} from "@/lib/website-restructure/storage";
import { runCompetitorResearch, runGeneration, runVisionBrief } from "@/lib/website-restructure/agent";
import type { WrCompetitorNote, WrVersion } from "@/lib/website-restructure/types";

export const maxDuration = 300;

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "version"; data: WrVersion; logoUrl: string | null }
  | { type: "error"; error: string };

function createNdjsonStream(
  executor: (push: (event: StreamEvent) => void) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await executor(push);
      } catch (error) {
        push({ type: "error", error: error instanceof Error ? error.message : "Build failed" });
      } finally {
        controller.close();
      }
    },
  });
}

async function downloadImageBase64(
  admin: SupabaseClient,
  storagePath: string
): Promise<{ mimeType: string; data: string } | null> {
  const { data, error } = await admin.storage.from(WR_STORAGE_BUCKET).download(storagePath);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return { mimeType: data.type || "image/jpeg", data: Buffer.from(buf).toString("base64") };
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = buildBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid build payload", 400);
  const { workspaceId, projectId, storeLanguageHint } = parsed.data;

  const auth = await requireWrAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  const project = await getWrProjectRow(auth.admin, workspaceId, projectId);
  if (!project) return jsonError("Project not found", 404);
  if (project.phase !== "awaiting_competitors" && project.phase !== "failed") {
    return jsonError(`Cannot build from phase "${project.phase}"`, 409);
  }
  if (project.state.images.length === 0) {
    return jsonError("Upload at least one header screenshot before building", 400);
  }

  const leased = await tryLeaseWrProjectBuild(auth.admin, workspaceId, projectId);
  if (!leased) return jsonError("A build is already running for this project", 409);

  const stream = createNdjsonStream(async (push) => {
    try {
      push({ type: "status", message: "Loading store categories and navigation" });
      const tree = await loadWrTaxonomyAdmin(auth.admin, workspaceId, projectId);
      if (!tree) throw new Error("Store categories were not loaded yet — reopen the project and try again.");

      const downloaded = await Promise.all(
        project.state.images.map(async (img) => ({
          asset: img,
          image: await downloadImageBase64(auth.admin, img.storagePath),
        }))
      );
      for (const { asset, image } of downloaded) {
        if (!image) {
          console.warn(
            `[website-restructure/build] screenshot "${asset.filename}" (${asset.storagePath}) could not be read from storage and is not part of this build`
          );
        }
      }
      const images = downloaded
        .map(({ image }) => image)
        .filter((img): img is { mimeType: string; data: string } => Boolean(img));
      if (images.length === 0) throw new Error("Could not read any uploaded header screenshot.");

      const logoImage = project.state.logo
        ? await downloadImageBase64(auth.admin, project.state.logo.storagePath)
        : null;
      // A logo the merchant uploaded but that can't be read would otherwise be
      // silently skipped, and the brief would come back describing a header
      // with no logo at all.
      if (project.state.logo && !logoImage) {
        throw new Error(
          "Your uploaded logo could not be read from storage. Re-upload the logo and build again."
        );
      }

      push({
        type: "status",
        message: `Analyzing ${images.length} screenshot${images.length === 1 ? "" : "s"}${
          logoImage ? " and your logo" : ""
        }`,
      });

      const { brief } = await runVisionBrief({ images, logoImage, taxonomyTree: tree, storeLanguageHint });

      const competitorNotes: WrCompetitorNote[] = [];
      if (!project.state.competitorsSkipped && project.state.competitors.length > 0) {
        for (const competitor of project.state.competitors) {
          push({ type: "status", message: `Researching ${competitor.raw}` });
          try {
            const { note } = await runCompetitorResearch({ competitor: competitor.raw });
            competitorNotes.push(note);
          } catch (err) {
            console.warn("[website-restructure/build] competitor research failed:", err);
          }
        }
      }

      push({ type: "status", message: "Building your header" });
      const { result } = await runGeneration({ brief, competitorNotes, taxonomyTree: tree });

      await saveWrGenerationContextAdmin(auth.admin, workspaceId, projectId, { brief, competitorNotes });
      const version: WrVersion = {
        version: 1,
        createdAt: new Date().toISOString(),
        notes: result.notes,
        result,
      };
      await saveWrVersionAdmin(auth.admin, workspaceId, projectId, version);
      await releaseWrProjectBuild(auth.admin, workspaceId, projectId, {
        ok: true,
        nextPhase: "editing",
        activeVersion: 1,
      });

      let logoUrl: string | null = null;
      if (project.state.logo) {
        const { data: signed } = await auth.admin.storage
          .from(WR_STORAGE_BUCKET)
          .createSignedUrl(project.state.logo.storagePath, 3600);
        logoUrl = signed?.signedUrl ?? null;
      }

      push({ type: "version", data: version, logoUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Build failed";
      await releaseWrProjectBuild(auth.admin, workspaceId, projectId, {
        ok: false,
        nextPhase: "failed",
        error: message,
      }).catch(() => undefined);
      push({ type: "error", error: message });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
      ...auth.headers,
    },
  });
}

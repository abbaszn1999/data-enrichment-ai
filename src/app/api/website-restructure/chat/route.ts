// Post-build edits: brief + current version's code + the instruction go back
// to the model, which returns the full updated html/css/js. Counts against
// the 10-message edit budget only when generation actually succeeds.

import { NextRequest } from "next/server";
import { requireWrAuth } from "@/lib/website-restructure/auth";
import { chatEditBodySchema, jsonError } from "@/lib/website-restructure/api-schema";
import {
  getWrProjectRow,
  releaseWrProjectBuild,
  tryLeaseWrProjectBuild,
  updateWrProjectState,
} from "@/lib/website-restructure/server-persist";
import {
  loadWrBriefAdmin,
  loadWrTaxonomyAdmin,
  loadWrVersionAdmin,
  saveWrVersionAdmin,
  WR_STORAGE_BUCKET,
} from "@/lib/website-restructure/storage";
import { runEdit } from "@/lib/website-restructure/agent";
import { WR_MAX_EDIT_MESSAGES } from "@/lib/website-restructure/types";
import type { WrChatMessage, WrVersion } from "@/lib/website-restructure/types";

export const maxDuration = 300;

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "version"; data: WrVersion; logoUrl: string | null; editMessagesUsed: number }
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
        push({ type: "error", error: error instanceof Error ? error.message : "Edit failed" });
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const parsed = chatEditBodySchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid edit payload", 400);
  const { workspaceId, projectId, instruction } = parsed.data;

  const auth = await requireWrAuth({ workspaceId, requireWrite: true });
  if (!auth.ok) return auth.response;

  const project = await getWrProjectRow(auth.admin, workspaceId, projectId);
  if (!project) return jsonError("Project not found", 404);
  if (project.phase !== "editing") return jsonError(`Cannot edit from phase "${project.phase}"`, 409);
  if (project.editMessagesUsed >= WR_MAX_EDIT_MESSAGES) {
    return jsonError("The edit message limit has been reached for this project", 409);
  }

  const leased = await tryLeaseWrProjectBuild(auth.admin, workspaceId, projectId);
  if (!leased) return jsonError("A build is already running for this project", 409);

  const stream = createNdjsonStream(async (push) => {
    try {
      const [brief, tree, currentVersion] = await Promise.all([
        loadWrBriefAdmin(auth.admin, workspaceId, projectId),
        loadWrTaxonomyAdmin(auth.admin, workspaceId, projectId),
        loadWrVersionAdmin(auth.admin, workspaceId, projectId, project.activeVersion),
      ]);
      if (!brief || !tree || !currentVersion) {
        throw new Error("Missing prior build data — this project needs a fresh build.");
      }

      push({ type: "status", message: "Applying your changes" });
      const userMessage: WrChatMessage = { id: crypto.randomUUID(), role: "user", text: instruction };
      const recentChat = [...project.state.chat, userMessage];

      const { result } = await runEdit({
        brief,
        currentResult: currentVersion.result,
        taxonomyTree: tree,
        recentChat,
        instruction,
      });

      const nextVersionNumber = project.activeVersion + 1;
      const version: WrVersion = {
        version: nextVersionNumber,
        createdAt: new Date().toISOString(),
        notes: result.notes,
        result,
        instruction,
      };
      await saveWrVersionAdmin(auth.admin, workspaceId, projectId, version);

      const agentMessage: WrChatMessage = {
        id: crypto.randomUUID(),
        role: "agent",
        text: result.notes || "Updated your header.",
      };
      await updateWrProjectState(auth.admin, workspaceId, projectId, {
        ...project.state,
        chat: [...recentChat, agentMessage].slice(-60),
      });

      await releaseWrProjectBuild(auth.admin, workspaceId, projectId, {
        ok: true,
        nextPhase: "editing",
        activeVersion: nextVersionNumber,
        incrementEditMessages: true,
      });

      let logoUrl: string | null = null;
      if (project.state.logo) {
        const { data: signed } = await auth.admin.storage
          .from(WR_STORAGE_BUCKET)
          .createSignedUrl(project.state.logo.storagePath, 3600);
        logoUrl = signed?.signedUrl ?? null;
      }

      push({
        type: "version",
        data: version,
        logoUrl,
        editMessagesUsed: Math.min(WR_MAX_EDIT_MESSAGES, project.editMessagesUsed + 1),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Edit failed";
      await releaseWrProjectBuild(auth.admin, workspaceId, projectId, {
        ok: false,
        nextPhase: "editing",
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

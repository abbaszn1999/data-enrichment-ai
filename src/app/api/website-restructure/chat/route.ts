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
  downloadWrImageAsInline,
  isWrChatAttachmentPath,
  loadWrBriefAdmin,
  loadWrTaxonomyAdmin,
  loadWrVersionAdmin,
  saveWrVersionAdmin,
  WR_STORAGE_BUCKET,
} from "@/lib/website-restructure/storage";
import { runEdit } from "@/lib/website-restructure/agent";
import { WR_MAX_EDIT_MESSAGES } from "@/lib/website-restructure/types";
import type { WrChatAttachment, WrChatMessage, WrUploadedImage, WrVersion } from "@/lib/website-restructure/types";
import {
  resolveWrEditInstruction,
  wrEditWantsLogoFromAttachments,
} from "@/lib/website-restructure/wr-chat-images";

export const maxDuration = 300;

type StreamEvent =
  | { type: "status"; message: string }
  | {
      type: "version";
      data: WrVersion;
      logoUrl: string | null;
      logo: WrUploadedImage | null;
      editMessagesUsed: number;
    }
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
  const attachments = parsed.data.attachments ?? [];
  const instruction = resolveWrEditInstruction(parsed.data.instruction, attachments.length);
  if (!instruction) return jsonError("Describe a change or attach an image", 400);
  const { workspaceId, projectId } = parsed.data;

  for (const att of attachments) {
    if (!isWrChatAttachmentPath(workspaceId, projectId, att.storagePath)) {
      return jsonError("Invalid image attachment", 400);
    }
    if (!att.mimeType.toLowerCase().startsWith("image/")) {
      return jsonError("Only image attachments are supported", 400);
    }
  }

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

      const editImages: Array<{ mimeType: string; data: string; filename: string }> = [];
      if (attachments.length > 0) {
        push({
          type: "status",
          message:
            attachments.length === 1 ? "Reading your attached image" : `Reading ${attachments.length} attached images`,
        });
        for (const att of attachments) {
          const inline = await downloadWrImageAsInline(auth.admin, att.storagePath);
          if (!inline) {
            console.warn(
              `[website-restructure/chat] attachment "${att.filename}" (${att.storagePath}) could not be read`
            );
            continue;
          }
          const mimeType = inline.mimeType.toLowerCase().startsWith("image/")
            ? inline.mimeType
            : att.mimeType || "image/png";
          editImages.push({ mimeType, data: inline.data, filename: att.filename });
        }
        if (editImages.length === 0) {
          throw new Error("Could not read the attached image. Try uploading it again.");
        }
      }

      push({ type: "status", message: "Applying your changes" });
      const userMessage: WrChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: instruction,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
      const recentChat = [...project.state.chat, userMessage];

      const { result } = await runEdit({
        brief,
        currentResult: currentVersion.result,
        taxonomyTree: tree,
        recentChat,
        instruction,
        images: editImages,
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

      const storedAttachments: WrChatAttachment[] = attachments.map((att) => ({
        id: att.id,
        storagePath: att.storagePath,
        filename: att.filename,
        mimeType: att.mimeType,
      }));
      const applyAsLogo = wrEditWantsLogoFromAttachments(instruction, storedAttachments.length);
      const nextLogo: WrUploadedImage | null = applyAsLogo && storedAttachments[0]
        ? {
            id: storedAttachments[0].id,
            storagePath: storedAttachments[0].storagePath,
            filename: storedAttachments[0].filename,
          }
        : project.state.logo;

      await updateWrProjectState(auth.admin, workspaceId, projectId, {
        ...project.state,
        logo: nextLogo,
        chat: [...recentChat, agentMessage].slice(-60),
      });

      await releaseWrProjectBuild(auth.admin, workspaceId, projectId, {
        ok: true,
        nextPhase: "editing",
        activeVersion: nextVersionNumber,
        incrementEditMessages: true,
      });

      let logoUrl: string | null = null;
      if (nextLogo) {
        const { data: signed } = await auth.admin.storage
          .from(WR_STORAGE_BUCKET)
          .createSignedUrl(nextLogo.storagePath, 3600);
        logoUrl = signed?.signedUrl ?? null;
      }

      push({
        type: "version",
        data: version,
        logoUrl,
        logo: nextLogo,
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

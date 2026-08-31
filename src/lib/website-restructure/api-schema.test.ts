import { describe, expect, it } from "vitest";
import { assetUploadBodySchema, chatEditBodySchema, wrChatMessageSchema } from "./api-schema";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

const attachment = {
  id: "att-1",
  storagePath: `${workspaceId}/website-restructure/${projectId}/chat/att-1.png`,
  filename: "logo.png",
  mimeType: "image/png",
};

describe("chatEditBodySchema", () => {
  it("accepts a text-only edit", () => {
    expect(chatEditBodySchema.parse({ workspaceId, projectId, instruction: "make it green" }).instruction).toBe(
      "make it green"
    );
  });

  it("accepts an image-only edit", () => {
    const parsed = chatEditBodySchema.parse({
      workspaceId,
      projectId,
      instruction: "",
      attachments: [attachment],
    });
    expect(parsed.attachments).toHaveLength(1);
  });

  it("rejects an empty edit with no images", () => {
    expect(chatEditBodySchema.safeParse({ workspaceId, projectId, instruction: "   " }).success).toBe(false);
  });

  it("rejects more than 4 attachments", () => {
    const attachments = Array.from({ length: 5 }, (_, i) => ({ ...attachment, id: `att-${i}` }));
    expect(
      chatEditBodySchema.safeParse({ workspaceId, projectId, instruction: "use these", attachments }).success
    ).toBe(false);
  });
});

describe("wrChatMessageSchema", () => {
  it("keeps attachments on a user bubble", () => {
    const parsed = wrChatMessageSchema.parse({
      id: "m1",
      role: "user",
      text: "use this logo",
      attachments: [attachment],
    });
    expect(parsed.attachments?.[0]?.filename).toBe("logo.png");
  });
});

describe("assetUploadBodySchema", () => {
  it("accepts kind chat", () => {
    expect(
      assetUploadBodySchema.parse({
        workspaceId,
        projectId,
        kind: "chat",
        filename: "logo.png",
        mimeType: "image/png",
        dataBase64: "abc",
      }).kind
    ).toBe("chat");
  });
});

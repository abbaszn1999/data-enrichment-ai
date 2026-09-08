import { WR_MAX_CHAT_ATTACHMENTS } from "./types";

export const WR_MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
export const WR_CHAT_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";

const ALLOWED_CHAT_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

export const WR_CHAT_IMAGE_ONLY_INSTRUCTION =
  "Use the attached image(s) in the header as appropriate.";

export function isWrChatImageFile(file: File): boolean {
  if (/\.svgz?$/i.test(file.name)) return false;
  const mime = (file.type || "").toLowerCase();
  if (mime && ALLOWED_CHAT_IMAGE_MIMES.has(mime)) return true;
  if (!mime && /\.(png|jpe?g|webp|gif)$/i.test(file.name)) return true;
  return false;
}

export function wrChatImageFilesFromList(files: ArrayLike<File> | Iterable<File>): File[] {
  return Array.from(files as ArrayLike<File>).filter(isWrChatImageFile);
}

export function wrChatImageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = wrChatImageFilesFromList(data.files);
  if (fromFiles.length > 0) return fromFiles;
  const fromItems: File[] = [];
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isWrChatImageFile(file)) fromItems.push(file);
  }
  return fromItems;
}

export function wrChatImageFilename(file: File): string {
  const name = file.name?.trim();
  if (name && name !== "blob") return name.slice(0, 200);
  const mime = (file.type || "").toLowerCase();
  const ext =
    mime === "image/jpeg" || mime === "image/jpg"
      ? "jpg"
      : mime === "image/webp"
        ? "webp"
        : mime === "image/gif"
          ? "gif"
          : "png";
  return `pasted-image.${ext}`;
}

export function resolveWrEditInstruction(instruction: string, attachmentCount: number): string {
  const trimmed = instruction.trim();
  if (trimmed) return trimmed;
  return attachmentCount > 0 ? WR_CHAT_IMAGE_ONLY_INSTRUCTION : "";
}

/**
 * When true, the first attached image becomes the project's logo file so
 * preview/export swap `{{WR_LOGO_SRC}}`. Palettes and "extract colors" stay
 * vision-only — the model reads hex values and updates CSS.
 */
export function wrEditWantsLogoFromAttachments(instruction: string, attachmentCount: number): boolean {
  if (attachmentCount < 1) return false;
  if (/logo|شعار|logotype|wordmark|brand\s*mark/i.test(instruction)) return true;
  const useThis = /use (this|it)|استخدم|استعمل|حط ه|ضع ه/i.test(instruction);
  const colorIntent = /colou?rs?|palette|ألوان|الوان|لون|hex/i.test(instruction);
  return attachmentCount === 1 && useThis && !colorIntent;
}

export function takeWrChatImages(files: File[], alreadyQueued: number): { accepted: File[]; rejectedReason?: string } {
  const images = wrChatImageFilesFromList(files);
  if (images.length === 0) return { accepted: [] };
  const oversized = images.find((f) => f.size > WR_MAX_CHAT_IMAGE_BYTES);
  if (oversized) {
    return { accepted: [], rejectedReason: `Images must be under ${WR_MAX_CHAT_IMAGE_BYTES / (1024 * 1024)}MB` };
  }
  const room = WR_MAX_CHAT_ATTACHMENTS - alreadyQueued;
  if (room <= 0) {
    return { accepted: [], rejectedReason: `You can attach up to ${WR_MAX_CHAT_ATTACHMENTS} images per message` };
  }
  if (images.length > room) {
    return {
      accepted: images.slice(0, room),
      rejectedReason: `You can attach up to ${WR_MAX_CHAT_ATTACHMENTS} images per message`,
    };
  }
  return { accepted: images };
}

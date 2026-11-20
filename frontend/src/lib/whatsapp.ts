import type { WhatsAppMessage } from "./types";

/** Merge a polled batch into the thread: no duplicates, the incoming copy wins, time order. */
export function mergeMessages(current: WhatsAppMessage[], incoming: WhatsAppMessage[]): WhatsAppMessage[] {
  const byId = new Map<number, WhatsAppMessage>();
  for (const msg of current) byId.set(msg.id, msg);
  for (const msg of incoming) byId.set(msg.id, msg);
  return [...byId.values()].sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at) || a.id - b.id);
}

const STATUS_LABELS: Record<WhatsAppMessage["status"], string> = {
  pending: "Отправляется",
  sent: "Отправлено",
  delivered: "Доставлено",
  read: "Прочитано",
  failed: "Ошибка",
  received: "",
};

export function statusLabel(m: Pick<WhatsAppMessage, "status">): string {
  return STATUS_LABELS[m.status] ?? "";
}

export function mediaKindFor(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

// Mirrors backend SAFE_INLINE_TYPES: the type comes from the client and can lie.
const INLINE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Only real raster images are rendered; anything else (e.g. SVG with a script) is a download. */
export function isInlineImage(mime: string): boolean {
  return INLINE_IMAGE_TYPES.has((mime || "").toLowerCase());
}

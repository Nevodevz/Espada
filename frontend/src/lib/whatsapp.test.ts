import { describe, expect, it } from "vitest";
import { mediaKindFor, mergeMessages, statusLabel } from "./whatsapp";
import type { WhatsAppMessage } from "./types";

const m = (id: number, sent_at: string, status: WhatsAppMessage["status"] = "sent") =>
  ({ id, sent_at, status, direction: "out", kind: "text", body: `m${id}`, error: "", sender: null,
     has_media: false, media_name: "", media_mime: "" }) as WhatsAppMessage;

describe("mergeMessages", () => {
  it("drops duplicates and keeps the newer version (status update)", () => {
    const merged = mergeMessages([m(1, "2026-11-20T04:00:00Z", "sent")], [m(1, "2026-11-20T04:00:00Z", "read")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("read");
  });
  it("sorts by time, then id", () => {
    const merged = mergeMessages([m(3, "2026-11-20T05:00:00Z")], [m(2, "2026-11-20T04:00:00Z"), m(1, "2026-11-20T04:00:00Z")]);
    expect(merged.map((x) => x.id)).toEqual([1, 2, 3]);
  });
});

describe("statusLabel", () => {
  it.each([
    ["pending", "Отправляется"], ["sent", "Отправлено"], ["delivered", "Доставлено"],
    ["read", "Прочитано"], ["failed", "Ошибка"], ["received", ""],
  ] as const)("%s → %s", (status, label) => {
    expect(statusLabel(m(1, "2026-11-20T04:00:00Z", status))).toBe(label);
  });
});

describe("mediaKindFor", () => {
  it("maps mime types", () => {
    expect(mediaKindFor("image/png")).toBe("image");
    expect(mediaKindFor("video/mp4")).toBe("video");
    expect(mediaKindFor("audio/ogg")).toBe("audio");
    expect(mediaKindFor("application/pdf")).toBe("document");
  });
});

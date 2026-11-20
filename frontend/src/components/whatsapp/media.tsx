"use client";

import { useEffect, useState } from "react";
import { whatsappApi } from "@/lib/api";

/** Image from the protected media endpoint, loaded with the auth header (never linked: a blob
 *  URL opened in a tab would run with the CRM origin). Only call for isInlineImage() types. */
export function ProtectedImage({ messageId, alt }: { messageId: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    whatsappApi.mediaUrl(messageId).then((u) => {
      if (cancelled) URL.revokeObjectURL(u);
      else { objectUrl = u; setUrl(u); }
    }).catch(() => {});
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [messageId]);
  if (!url) return <div style={{ fontSize: 12, color: "var(--text3)" }}>Загрузка изображения…</div>;
  return <img src={url} alt={alt} style={{ display: "block", maxWidth: 260, maxHeight: 260, borderRadius: 6 }} />;
}

/** Download a client file through the protected endpoint. */
export async function downloadMedia(messageId: number, name: string) {
  const url = await whatsappApi.mediaUrl(messageId);
  const a = document.createElement("a");
  a.href = url;
  a.download = name || "file";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

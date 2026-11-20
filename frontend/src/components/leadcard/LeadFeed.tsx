"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { leadFeedApi } from "@/lib/api";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { TASK_KIND_ICONS, TASK_KIND_LABELS } from "@/lib/leadTasks";
import { isInlineImage, statusLabel } from "@/lib/whatsapp";
import { ProtectedImage, downloadMedia } from "@/components/whatsapp/media";
import type { FeedItem, LeadTaskKind, WhatsAppMessage } from "@/lib/types";

const POLL_MS = 5000;

/** Merge pages by key, oldest first (the feed reads like a chat). */
function mergeFeed(current: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const byKey = new Map(current.map((i) => [i.key, i]));
  for (const item of incoming) byKey.set(item.key, item);
  return [...byKey.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}

const RESULT_TEXT: Record<string, string> = {
  connected: "✅ Дозвонился", no_answer: "📵 Недозвон", done: "✔ Выполнено", rescheduled: "🕒 Перенесено",
};

function Message({ item }: { item: FeedItem }) {
  const d = item.data;
  const out = d.direction === "out";
  return (
    <div style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "78%", padding: "7px 10px", borderRadius: 10, fontSize: 13,
        background: out ? "var(--primary-bg, var(--bg2))" : "var(--bg2)",
        border: `1px solid ${d.status === "failed" ? "var(--red)" : "var(--border)"}`,
      }}>
        {d.has_media && isInlineImage(d.media_mime) && <ProtectedImage messageId={d.id} alt={d.media_name || "Изображение"} />}
        {d.has_media && !isInlineImage(d.media_mime) && (
          <button type="button" onClick={() => downloadMedia(d.id, d.media_name).catch(() => {})}
            style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 6, padding: "5px 8px", cursor: "pointer", color: "var(--text)", font: "inherit" }}>
            📎 {d.media_name || "Файл"}
          </button>
        )}
        {!d.has_media && d.kind !== "text" && <div style={{ fontSize: 11, color: "var(--text3)" }}>[вложение не получено]</div>}
        {d.body && <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{d.body}</div>}
        <div style={{ marginTop: 3, fontSize: 11, color: "var(--text3)" }}>
          WhatsApp · {out ? `${item.actor ? item.actor.name : "с телефона"} · ` : ""}{fmtDateTime(item.at)}
          {out && statusLabel(d as WhatsAppMessage) ? ` · ${statusLabel(d as WhatsAppMessage)}` : ""}
        </div>
        {d.status === "failed" && d.error && <div style={{ fontSize: 11, color: "var(--red)" }}>{d.error}</div>}
      </div>
    </div>
  );
}

function SystemLine({ item }: { item: FeedItem }) {
  const d = item.data;
  const who = item.actor ? ` — ${item.actor.name}` : "";
  let text: React.ReactNode;
  switch (item.type) {
    case "created": text = "Лид создан"; break;
    case "stage": text = <>Этап: {d.from || "—"} → <b>{d.to || "—"}</b>{d.comment ? ` · ${d.comment}` : ""}</>; break;
    case "activity":
      // System activities (lower-case codes like «whatsapp») read better as their description alone.
      text = /^[a-z_]+$/.test(d.activity_type || "")
        ? <>{d.description || d.activity_type}</>
        : <>{d.activity_type}{d.channel ? ` (${d.channel})` : ""}{d.description ? `: ${d.description}` : ""}</>;
      break;
    case "meeting": text = <>🤝 Встреча назначена на {fmtDateTime(d.meeting_date)}{d.closer ? ` · ${d.closer}` : ""}{d.address ? ` · ${d.address}` : ""}</>; break;
    case "task_created": text = <>{TASK_KIND_ICONS[d.kind as LeadTaskKind] ?? "📌"} Задача «{TASK_KIND_LABELS[d.kind as LeadTaskKind] ?? "Задача"}» на {fmtDateTime(d.due_at)}{d.assignee ? ` · ${d.assignee}` : ""}{d.comment ? ` · ${d.comment}` : ""}</>; break;
    case "task_done": text = <>{RESULT_TEXT[d.result] ?? "✔ Выполнено"}{d.kind !== "call" ? ` · ${TASK_KIND_LABELS[d.kind as LeadTaskKind] ?? ""}` : ""}{d.note ? `: ${d.note}` : ""}</>; break;
    case "file": text = <>📄 Файл: <a href={d.url} target="_blank" rel="noreferrer">{d.name}</a></>; break;
    case "payment": text = <>💰 Оплата {fmtMoney(d.amount)}{d.method ? ` · ${d.method}` : ""}</>; break;
    default: text = item.type;
  }
  return (
    <div style={{ fontSize: 12, color: "var(--text2)", padding: "3px 0" }}>
      <span style={{ color: "var(--text3)", marginRight: 6 }}>{fmtDateTime(item.at)}</span>{text}{who}
    </div>
  );
}

function Note({ item }: { item: FeedItem }) {
  return (
    <div style={{ background: "var(--yellow-bg, #fff8e6)", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }}>
      <div style={{ whiteSpace: "pre-wrap" }}>{item.data.description}</div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>Примечание · {item.actor?.name ?? ""} · {fmtDateTime(item.at)}</div>
    </div>
  );
}

/** The lead's single history: WhatsApp, notes, touches, stages, meetings, tasks, files, payments. */
export function LeadFeed({ leadId, refreshKey }: { leadId: number; refreshKey: number }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [older, setOlder] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const loadLatest = useCallback(async () => {
    try {
      const page = await leadFeedApi.page(leadId);
      setItems((prev) => {
        if (!prev.length) setOlder(page.next_before);
        return mergeFeed(prev, page.items);
      });
    } catch { /* retried on the next tick */ } finally { setLoaded(true); }
  }, [leadId]);

  useEffect(() => { setItems([]); setOlder(null); setLoaded(false); stickToBottom.current = true; }, [leadId]);
  useEffect(() => { loadLatest(); }, [loadLatest, refreshKey]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") loadLatest(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [loadLatest]);

  // Keep the newest events in view while content grows (new items, images finishing loading).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const toBottom = () => { if (stickToBottom.current) el.scrollTop = el.scrollHeight; };
    toBottom();
    const observer = new ResizeObserver(toBottom);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [items]);

  async function loadOlder() {
    if (!older || loadingOlder) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const page = await leadFeedApi.page(leadId, older);
      stickToBottom.current = false;
      setItems((prev) => mergeFeed(prev, page.items));
      setOlder(page.next_before);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - fromBottom; });
    } finally { setLoadingOlder(false); }
  }

  return (
    <div ref={listRef} onScroll={(e) => {
      const el = e.currentTarget;
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (el.scrollTop < 60) loadOlder();
    }} style={{ flex: 1, minHeight: 260, maxHeight: 560, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, background: "var(--bg3)", borderRadius: 10 }}>
      {older && <button type="button" onClick={loadOlder} disabled={loadingOlder}
        style={{ alignSelf: "center", background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: 12 }}>
        {loadingOlder ? "Загрузка…" : "Показать раньше"}</button>}
      {!loaded && <div style={{ margin: "auto", color: "var(--text3)", fontSize: 13 }}>Загрузка истории…</div>}
      {items.map((item) =>
        item.type === "message" ? <Message key={item.key} item={item} />
          : item.type === "note" ? <Note key={item.key} item={item} />
          : <SystemLine key={item.key} item={item} />)}
    </div>
  );
}

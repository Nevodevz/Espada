"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { whatsappApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { mergeMessages, statusLabel } from "@/lib/whatsapp";
import type { WhatsAppChat, WhatsAppMessage } from "@/lib/types";

const POLL_MS = 5000;

/** Image from the protected media endpoint, loaded with the auth header. */
function ProtectedImage({ messageId, alt }: { messageId: number; alt: string }) {
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
  if (!url) return <div className="wa-media-loading">Загрузка изображения…</div>;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={alt} className="wa-image" /></a>;
}

async function download(m: WhatsAppMessage) {
  const url = await whatsappApi.mediaUrl(m.id);
  const a = document.createElement("a");
  a.href = url;
  a.download = m.media_name || "file";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Bubble({ m }: { m: WhatsAppMessage }) {
  const out = m.direction === "out";
  return (
    <div className={`wa-row ${out ? "wa-out" : "wa-in"}`}>
      <div className={`wa-bubble${m.status === "failed" ? " wa-failed" : ""}`}>
        {m.has_media && m.kind === "image" && <ProtectedImage messageId={m.id} alt={m.media_name || "Изображение"} />}
        {m.has_media && m.kind !== "image" && (
          <button type="button" className="wa-file" onClick={() => download(m).catch(() => {})}>
            📎 {m.media_name || "Файл"}
          </button>
        )}
        {!m.has_media && m.kind !== "text" && <div className="wa-meta">[{m.kind === "audio" ? "голосовое" : "вложение"} — файл не получен]</div>}
        {m.body && <div className="wa-text">{m.body}</div>}
        <div className="wa-meta">
          {out && <span>{m.sender ? m.sender.name : "с телефона"} · </span>}
          {fmtDateTime(m.sent_at)}
          {out && statusLabel(m) && <span> · {statusLabel(m)}</span>}
        </div>
        {m.status === "failed" && m.error && <div className="wa-error">{m.error}</div>}
      </div>
    </div>
  );
}

export function LeadWhatsAppChat({ leadId, onChat }: { leadId: number; onChat?: (chat: WhatsAppChat | null) => void }) {
  const [chat, setChat] = useState<WhatsAppChat | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Parent callbacks are usually inline; a ref keeps polling from restarting on every render.
  const onChatRef = useRef(onChat);
  onChatRef.current = onChat;

  const load = useCallback(async (incremental: boolean) => {
    try {
      const thread = await whatsappApi.messages(leadId, incremental ? lastId.current : undefined);
      setChat(thread.chat);
      onChatRef.current?.(thread.chat);
      setMessages((prev) => {
        const next = incremental ? mergeMessages(prev, thread.messages) : thread.messages;
        lastId.current = next.reduce((max, m) => Math.max(max, m.id), lastId.current ?? 0) || undefined;
        return next;
      });
    } catch {
      /* polling: a transient failure is retried on the next tick */
    } finally {
      setLoaded(true);
    }
  }, [leadId]);

  useEffect(() => {
    lastId.current = undefined;
    load(false);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function send(action: () => Promise<WhatsAppMessage>) {
    setSending(true);
    setError(null);
    try {
      const sent = await action();
      setMessages((prev) => mergeMessages(prev, [sent]));
      lastId.current = Math.max(lastId.current ?? 0, sent.id);
      return true;
    } catch (failure) {
      setError((failure as Error).message || "Не удалось отправить");
      await load(true); // the failed message is stored with status «Ошибка» — show it
      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendText() {
    const value = text.trim();
    if (!value || sending) return;
    if (await send(() => whatsappApi.sendText(leadId, value))) setText("");
  }

  async function sendFile(file: File) {
    if (await send(() => whatsappApi.sendMedia(leadId, file, text.trim()))) setText("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="wa-chat">
      <div className="wa-head">
        <span>WhatsApp{chat ? ` · +${chat.phone}` : ""}</span>
        {chat?.is_ignored && <span className="wa-badge">помечен «Не лид»</span>}
      </div>
      <div ref={listRef} className="wa-list" aria-live="polite">
        {!loaded && <div className="wa-empty">Загрузка переписки…</div>}
        {loaded && !messages.length && <div className="wa-empty">Переписки пока нет. Можно написать клиенту первым.</div>}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
      </div>
      <div className="wa-compose">
        <textarea
          value={text}
          placeholder="Сообщение клиенту… (Enter — отправить, Shift+Enter — новая строка)"
          rows={2}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); }
          }}
        />
        <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) sendFile(f); }} />
        <Button variant="ghost" disabled={sending} onClick={() => fileRef.current?.click()} title="Прикрепить файл (текст станет подписью)">📎</Button>
        <Button loading={sending} disabled={sending || !text.trim()} onClick={sendText}>Отправить</Button>
      </div>
      {error && <div role="alert" className="wa-error">{error}</div>}
      <style jsx>{`
        .wa-chat { border:1px solid var(--border); border-radius:12px; background:var(--bg2); display:flex; flex-direction:column; }
        .wa-head { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--border); font-size:13px; font-weight:600; color:var(--text); }
        .wa-badge { font-size:11px; font-weight:500; color:var(--text3); }
        .wa-list { max-height:460px; min-height:180px; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:8px; background:var(--bg3); }
        .wa-empty { margin:auto; color:var(--text3); font-size:13px; text-align:center; }
        .wa-row { display:flex; }
        .wa-in { justify-content:flex-start; }
        .wa-out { justify-content:flex-end; }
        .wa-bubble { max-width:75%; padding:8px 10px; border-radius:10px; background:var(--bg2); border:1px solid var(--border); font-size:13px; color:var(--text); }
        .wa-out .wa-bubble { background:var(--primary-bg, var(--bg2)); }
        .wa-failed { border-color:var(--red); }
        .wa-text { white-space:pre-wrap; overflow-wrap:anywhere; }
        .wa-meta { margin-top:4px; font-size:11px; color:var(--text3); }
        .wa-error { margin:6px 14px; font-size:12px; color:var(--red); }
        .wa-file { background:none; border:1px dashed var(--border); border-radius:6px; padding:6px 8px; cursor:pointer; color:var(--text); font:inherit; }
        .wa-image { display:block; max-width:260px; max-height:260px; border-radius:6px; }
        .wa-media-loading { font-size:12px; color:var(--text3); }
        .wa-compose { display:flex; gap:8px; align-items:flex-end; padding:10px; border-top:1px solid var(--border); }
        .wa-compose textarea { flex:1; resize:vertical; min-height:40px; border:1px solid var(--border); border-radius:8px; padding:8px; background:var(--bg-input, var(--bg2)); color:var(--text); font:inherit; font-size:13px; }
      `}</style>
    </div>
  );
}

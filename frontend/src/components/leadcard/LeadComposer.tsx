"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { leadFeedApi, leadTasksApi, whatsappApi } from "@/lib/api";
import { localInputToUtc, utcToLocalInput } from "@/lib/format";
import { QUICK_DUE_LABELS, TASK_KIND_ICONS, TASK_KIND_LABELS, quickDue, type QuickDue } from "@/lib/leadTasks";
import type { LeadTaskKind, User } from "@/lib/types";

export type ComposerTab = "whatsapp" | "note" | "task";

const chip = (on: boolean): React.CSSProperties => ({
  padding: "4px 10px", borderRadius: 14, fontSize: 12, cursor: "pointer", font: "inherit",
  border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
  background: on ? "var(--primary)" : "transparent", color: on ? "#fff" : "var(--text2)",
});

/** One input for the lead: WhatsApp message, note, or a task. */
export function LeadComposer({ leadId, canWhatsApp, tab, onTab, assignees, currentUserId, onSent }: {
  leadId: number;
  canWhatsApp: boolean;
  tab: ComposerTab;
  onTab: (tab: ComposerTab) => void;
  assignees: User[];
  currentUserId?: number;
  onSent: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // task form
  const [kind, setKind] = useState<LeadTaskKind>("call");
  const [quick, setQuick] = useState<Exclude<QuickDue, "callback"> | "custom">("1h");
  const [custom, setCustom] = useState("");
  const [assignee, setAssignee] = useState<string>("");

  async function submit(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setText("");
      toast(done, "success");
      onSent();
    } catch (e: unknown) {
      setError((e as Error).message || "Не удалось сохранить");
      onSent(); // a failed WhatsApp message is stored as «Ошибка» — show it in the feed
    } finally { setBusy(false); }
  }

  function dueIso(): string | null {
    if (quick === "custom") return custom ? localInputToUtc(custom) : null;
    return quickDue(quick, new Date())?.toISOString() ?? null;
  }

  const tabs: { id: ComposerTab; label: string }[] = [
    ...(canWhatsApp ? [{ id: "whatsapp" as const, label: "WhatsApp" }] : []),
    { id: "note", label: "Примечание" },
    { id: "task", label: "Задача" },
  ];
  const now = new Date();

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, marginTop: 10, background: "var(--bg2)" }}>
      <div role="tablist" style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => { setError(null); onTab(t.id); }}
            style={{ ...chip(tab === t.id), borderRadius: 6 }}>{t.label}</button>
        ))}
      </div>

      {tab !== "task" && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea className="form-input" rows={2} value={text} disabled={busy} style={{ resize: "vertical", flex: 1 }}
            placeholder={tab === "whatsapp" ? "Сообщение клиенту… (Enter — отправить, Shift+Enter — новая строка)" : "Примечание для команды…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && tab === "whatsapp") {
                e.preventDefault();
                if (text.trim() && !busy) submit(() => whatsappApi.sendText(leadId, text.trim()), "Отправлено");
              }
            }} />
          {tab === "whatsapp" && (
            <>
              <input ref={fileRef} type="file" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) submit(() => whatsappApi.sendMedia(leadId, f, text.trim()), "Файл отправлен");
                if (fileRef.current) fileRef.current.value = "";
              }} />
              <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()} title="Прикрепить файл (текст станет подписью)">📎</Button>
              <Button loading={busy} disabled={busy || !text.trim()} onClick={() => submit(() => whatsappApi.sendText(leadId, text.trim()), "Отправлено")}>Отправить</Button>
            </>
          )}
          {tab === "note" && (
            <Button loading={busy} disabled={busy || !text.trim()} onClick={() => submit(() => leadFeedApi.addNote(leadId, text.trim()), "Примечание добавлено")}>Сохранить</Button>
          )}
        </div>
      )}

      {tab === "task" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(TASK_KIND_LABELS) as LeadTaskKind[]).map((k) => (
              <button key={k} type="button" style={chip(kind === k)} onClick={() => setKind(k)}>{TASK_KIND_ICONS[k]} {TASK_KIND_LABELS[k]}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "var(--text3)" }}>Когда:</span>
            {(Object.keys(QUICK_DUE_LABELS) as Exclude<QuickDue, "callback">[]).map((k) =>
              quickDue(k, now) ? <button key={k} type="button" style={chip(quick === k)} onClick={() => setQuick(k)}>{QUICK_DUE_LABELS[k]}</button> : null)}
            <button type="button" style={chip(quick === "custom")} onClick={() => setQuick("custom")}>📅 дата и время…</button>
            {quick === "custom" && (
              <input type="datetime-local" className="form-input" style={{ width: 200 }} value={custom}
                min={utcToLocalInput(now.toISOString())} onChange={(e) => setCustom(e.target.value)} />
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "var(--text3)" }}>Кому:</span>
            <select className="form-input" style={{ width: 220 }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Я</option>
              {assignees.filter((u) => u.id !== currentUserId).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="form-input" style={{ flex: 1 }} placeholder="Комментарий: что сделать" value={text} onChange={(e) => setText(e.target.value)} />
            <Button loading={busy} disabled={busy || !dueIso()} onClick={() => {
              const due = dueIso();
              if (due) submit(() => leadTasksApi.create(leadId, {
                kind, due_at: due, assignee_id: assignee ? Number(assignee) : null, comment: text.trim(),
              }), "Задача поставлена");
            }}>Поставить</Button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

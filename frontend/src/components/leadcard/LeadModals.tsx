"use client";

// Lead card modals: touch and file link. Moved unchanged from app/leads/[id]/page.tsx
// (the «следующее действие» fields are gone — next steps are lead tasks now).
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { leadApi } from "@/lib/api";
import type { UserWithStats } from "@/lib/types";
import { ACTIVITY_TYPES, FILE_TYPES } from "@/lib/types";

// ── Add Activity Modal ───────────────────────────────────────────
export function AddActivityModal({ leadId, users, onClose, onAdded }: {
  leadId: number; users: UserWithStats[]; onClose: () => void; onAdded: () => void;
}) {
  const toast = useToast();
  const { user } = useApp();
  const [form, setForm] = useState({ activity_type: ACTIVITY_TYPES[0] as string, channel: "", description: "", responsible_id: "" });
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await leadApi.addActivity(leadId, {
        activity_type: form.activity_type,
        channel: form.channel,
        description: form.description,
        responsible_id: form.responsible_id ? Number(form.responsible_id) : user?.id,
      });
      toast("Касание добавлено", "success");
      onAdded();
      onClose();
    } catch (e: unknown) { toast((e as Error).message, "error"); }
    setSaving(false);
  }

  return (
    <Modal open title="Добавить касание" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label className="form-label">Тип касания</label>
          <select className="form-input" value={form.activity_type} onChange={e => setForm(f => ({ ...f, activity_type: e.target.value }))}>
            {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Канал</label>
          <input className="form-input" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} placeholder="WhatsApp, телефон, почта..." />
        </div>
        <div>
          <label className="form-label">Содержание</label>
          <textarea className="form-input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ resize: "vertical" }} />
        </div>
        <div>
          <label className="form-label">Ответственный</label>
          <select className="form-input" value={form.responsible_id} onChange={e => setForm(f => ({ ...f, responsible_id: e.target.value }))}>
            <option value="">— текущий пользователь —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn" onClick={submit} disabled={saving}>{saving ? "Сохранение..." : "Добавить"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Add File Modal ───────────────────────────────────────────────
export function AddFileModal({ leadId, onClose, onAdded }: { leadId: number; onClose: () => void; onAdded: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", url: "", file_type: FILE_TYPES[0] as string });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.name.trim() || !form.url.trim()) { toast("Заполните название и ссылку", "error"); return; }
    setSaving(true);
    try {
      await leadApi.addFile(leadId, { name: form.name, url: form.url, file_type: form.file_type });
      toast("Файл добавлен", "success");
      onAdded(); onClose();
    } catch (e: unknown) { toast((e as Error).message, "error"); }
    setSaving(false);
  }

  return (
    <Modal open title="Добавить файл / ссылку" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <label className="form-label">Тип документа</label>
          <select className="form-input" value={form.file_type} onChange={e => setForm(f => ({ ...f, file_type: e.target.value }))}>
            {FILE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Название</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="КП для клиента" />
        </div>
        <div>
          <label className="form-label">Ссылка (URL)</label>
          <input className="form-input" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://docs.google.com/..." />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn" onClick={submit} disabled={saving}>{saving ? "Сохранение..." : "Добавить"}</button>
        </div>
      </div>
    </Modal>
  );
}

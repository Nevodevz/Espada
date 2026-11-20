"use client";

// Lead card modals: touch, file link, edit. Moved unchanged from app/leads/[id]/page.tsx
// (the «следующее действие» fields are gone — next steps are lead tasks now).
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { leadApi } from "@/lib/api";
import { closerOptions } from "@/lib/roles";
import type { LeadDetail, LeadSource, ServiceItem, UserWithStats } from "@/lib/types";
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

// ── Edit Lead Modal ──────────────────────────────────────────────
export function EditLeadModal({ lead, sources, services, users, onClose, onSaved }: {
  lead: LeadDetail; sources: LeadSource[]; services: ServiceItem[];
  users: UserWithStats[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    client_name: lead.client_name,
    company_name: lead.company_name,
    phone: lead.phone,
    whatsapp: lead.whatsapp,
    instagram: lead.instagram,
    email: lead.email,
    address: lead.address,
    website: lead.website,
    industry: lead.industry,
    employees_count: lead.employees_count != null ? String(lead.employees_count) : "",
    source_id: lead.source_id != null ? String(lead.source_id) : "",
    service_id: lead.service_id != null ? String(lead.service_id) : "",
    setter_id: lead.setter_id != null ? String(lead.setter_id) : "",
    closer_id: lead.closer_id != null ? String(lead.closer_id) : "",
    // Canonical deal amount — written through to Deal.amount by the API.
    deal_amount: String(lead.deal_amount ?? 0),
    comment: lead.comment,
    source_detail: lead.source_detail ?? "",
    content_ref: lead.content_ref ?? "",
    utm_source: lead.utm_source ?? "",
    utm_medium: lead.utm_medium ?? "",
    utm_campaign: lead.utm_campaign ?? "",
    utm_content: lead.utm_content ?? "",
    external_lead_id: lead.external_lead_id ?? "",
  });
  const [saving, setSaving] = useState(false);

  const f = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }));

  async function submit() {
    setSaving(true);
    try {
      await leadApi.update(lead.id, {
        client_name: form.client_name || undefined,
        company_name: form.company_name,
        phone: form.phone,
        whatsapp: form.whatsapp,
        instagram: form.instagram,
        email: form.email,
        address: form.address,
        website: form.website,
        industry: form.industry,
        employees_count: form.employees_count ? Number(form.employees_count) : null,
        source_id: form.source_id ? Number(form.source_id) : null,
        service_id: form.service_id ? Number(form.service_id) : null,
        setter_id: form.setter_id ? Number(form.setter_id) : null,
        closer_id: form.closer_id ? Number(form.closer_id) : null,
        deal_amount: form.deal_amount ? Number(form.deal_amount) : 0,
        comment: form.comment,
        source_detail: form.source_detail,
        content_ref: form.content_ref,
        utm_source: form.utm_source,
        utm_medium: form.utm_medium,
        utm_campaign: form.utm_campaign,
        utm_content: form.utm_content,
        external_lead_id: form.external_lead_id,
      });
      toast("Лид обновлён", "success");
      onSaved(); onClose();
    } catch (e: unknown) { toast((e as Error).message, "error"); }
    setSaving(false);
  }

  return (
    <Modal open title="Редактировать лид" onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", maxHeight: "70vh", overflowY: "auto", padding: "4px 2px" }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="form-label">Имя клиента *</label>
          <input className="form-input" value={form.client_name} onChange={f("client_name")} />
        </div>
        <div><label className="form-label">Компания</label><input className="form-input" value={form.company_name} onChange={f("company_name")} /></div>
        <div><label className="form-label">Телефон</label><input className="form-input" value={form.phone} onChange={f("phone")} /></div>
        <div><label className="form-label">WhatsApp</label><input className="form-input" value={form.whatsapp} onChange={f("whatsapp")} /></div>
        <div><label className="form-label">Instagram</label><input className="form-input" value={form.instagram} onChange={f("instagram")} /></div>
        <div><label className="form-label">Email</label><input className="form-input" value={form.email} onChange={f("email")} /></div>
        <div><label className="form-label">Адрес</label><input className="form-input" value={form.address} onChange={f("address")} /></div>
        <div><label className="form-label">Сайт</label><input className="form-input" value={form.website} onChange={f("website")} /></div>
        <div><label className="form-label">Отрасль</label><input className="form-input" value={form.industry} onChange={f("industry")} /></div>
        <div><label className="form-label">Кол-во сотрудников</label><input className="form-input" type="number" value={form.employees_count} onChange={f("employees_count")} /></div>
        <div>
          <label className="form-label">Источник</label>
          <select className="form-input" value={form.source_id} onChange={f("source_id")}>
            <option value="">—</option>
            {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Услуга</label>
          <select className="form-input" value={form.service_id} onChange={f("service_id")}>
            <option value="">—</option>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Сеттер</label>
          <select className="form-input" value={form.setter_id} onChange={f("setter_id")}>
            <option value="">—</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Клоузер</label>
          <select className="form-input" value={form.closer_id} onChange={f("closer_id")}>
            <option value="">—</option>
            {closerOptions(users, lead.closer_id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div><label className="form-label">Сумма сделки (сом)</label><input className="form-input" type="number" min={0} value={form.deal_amount} onChange={f("deal_amount")} /></div>

        <div style={{ gridColumn: "1 / -1", marginTop: 6, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text3)" }}>
          Атрибуция
        </div>
        <div><label className="form-label">Уточнение источника</label><input className="form-input" value={form.source_detail} onChange={f("source_detail")} placeholder="Блогер, чат, рассылка…" /></div>
        <div><label className="form-label">Рилс / контент</label><input className="form-input" value={form.content_ref} onChange={f("content_ref")} placeholder="Ссылка или ID публикации" /></div>
        <div><label className="form-label">UTM source</label><input className="form-input" value={form.utm_source} onChange={f("utm_source")} /></div>
        <div><label className="form-label">UTM medium</label><input className="form-input" value={form.utm_medium} onChange={f("utm_medium")} /></div>
        <div><label className="form-label">UTM campaign</label><input className="form-input" value={form.utm_campaign} onChange={f("utm_campaign")} /></div>
        <div><label className="form-label">UTM content</label><input className="form-input" value={form.utm_content} onChange={f("utm_content")} /></div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="form-label">Внешний ID лида</label>
          <input className="form-input" value={form.external_lead_id} onChange={f("external_lead_id")} placeholder="ID из рекламной системы" />
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <label className="form-label">Комментарий</label>
          <textarea className="form-input" rows={3} value={form.comment} onChange={f("comment")} style={{ resize: "vertical" }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn" onClick={submit} disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
      </div>
    </Modal>
  );
}

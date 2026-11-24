"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { api, leadApi, meetingApi } from "@/lib/api";
import { existingLeadFromError } from "@/lib/apiError";
import { bishkekDateTimeParts, localInputToUtc, utcToLocalInput } from "@/lib/format";
import { createMeetingForClient, meetingFormFromLead } from "@/lib/meetingForm";
import type { Lead, Meeting, UserWithStats } from "@/lib/types";
import { DEFAULT_MEETING_MINUTES, MEETING_DURATIONS } from "@/lib/types";
import { CloserSlots } from "./CloserSlots";
import { LeadPicker } from "./LeadPicker";

/**
 * Create a CRM meeting.
 *
 * `defaultStart` comes from the calendar when a free slot is clicked, so the
 * date and time are already filled in. Without `leadId` (calendar case) the
 * client is picked from open leads, or a new lead is created on the fly.
 */
export function MeetingModal({
  open, onClose, onSaved, closers, defaultStart, parentId, leadId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (created?: Meeting) => void;
  closers: UserWithStats[];
  /** `YYYY-MM-DDTHH:mm` in Bishkek local time. */
  defaultStart?: string | null;
  parentId?: number | null;
  leadId?: number | null;
}) {
  const toast = useToast();
  const { user: me } = useApp();
  const pickMode = !leadId;
  const [pickedLeadId, setPickedLeadId] = useState<number | null>(null);
  const [newClientText, setNewClientText] = useState<string | null>(null);
  /** Open meeting of the picked lead — the backend reschedules it instead of adding a second one. */
  const [moved, setMoved] = useState<{ id: number; label: string } | null>(null);
  /** A typed-in new client whose phone already belongs to a lead (POST /leads → 409). */
  const [duplicate, setDuplicate] = useState<{ id: number; client_name: string } | null>(null);
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [form, setForm] = useState({
    closer_id: "", setter_id: "", meeting_date: "", address: "",
    client_name: "", client_phone: "", notes: "",
    duration_minutes: String(DEFAULT_MEETING_MINUTES),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      closer_id: closers[0]?.id ? String(closers[0].id) : "",
      setter_id: "",
      meeting_date: defaultStart ?? utcToLocalInput(new Date().toISOString()),
      address: "", client_name: "", client_phone: "", notes: "",
      duration_minutes: String(DEFAULT_MEETING_MINUTES),
    });
    setPickedLeadId(null);
    setNewClientText(null);
    setMoved(null);
    setDuplicate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultStart]);

  useEffect(() => {
    if (open && pickMode) api.listUsers().then(setUsers).catch(() => {});
  }, [open, pickMode]);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value }));

  function pickLead(lead: Lead) {
    const f = meetingFormFromLead(lead);
    setPickedLeadId(f.lead_id);
    setNewClientText(null);
    setMoved(null);
    setDuplicate(null);
    setForm((prev) => ({
      ...prev,
      client_name: f.client_name,
      client_phone: f.client_phone,
      setter_id: f.setter_id ? String(f.setter_id) : "",
    }));
    leadApi.get(f.lead_id).then((d) => {
      const m = d.scheduled_meeting;
      if (!m) return;
      const p = bishkekDateTimeParts(m.meeting_date);
      setMoved({ id: m.id, label: `${p.date.slice(8, 10)}.${p.date.slice(5, 7)} ${p.time}` });
    }).catch(() => {});
  }

  function pickNew(text: string) {
    setPickedLeadId(null);
    setMoved(null);
    setDuplicate(null);
    setNewClientText(text);
    setForm((prev) => ({
      ...prev, client_name: text, client_phone: "",
      setter_id: me ? String(me.id) : "",
    }));
  }

  function clearClient() {
    setPickedLeadId(null);
    setNewClientText(null);
    setMoved(null);
    setDuplicate(null);
    setForm((prev) => ({ ...prev, client_name: "", client_phone: "", setter_id: "" }));
  }

  async function save() {
    if (!form.client_name.trim() || !form.closer_id || !form.meeting_date) return;
    setSaving(true);
    try {
      const setterId = form.setter_id ? Number(form.setter_id) : (me?.id ?? null);
      const created = await createMeetingForClient({
        leadId: leadId ?? pickedLeadId,
        newClientText: pickMode ? newClientText : null,
        setterId,
        createLead: (payload) => leadApi.create(payload),
        // A retry after a failed meeting must reuse the lead we just made.
        onLeadCreated: (id) => { setPickedLeadId(id); setNewClientText(null); },
        createMeeting: (leadForMeeting) => meetingApi.create({
          closer_id: Number(form.closer_id),
          meeting_date: localInputToUtc(form.meeting_date),
          address: form.address,
          client_name: form.client_name.trim(),
          client_phone: form.client_phone,
          notes: form.notes,
          duration_minutes: Number(form.duration_minutes) || DEFAULT_MEETING_MINUTES,
          parent_id: parentId ?? null,
          lead_id: leadForMeeting,
          ...(pickMode && form.setter_id ? { setter_id: Number(form.setter_id) } : {}),
        }),
      });
      toast("Встреча назначена");
      onClose();
      onSaved(created);
    } catch (e: unknown) {
      const existing = existingLeadFromError(e);
      if (existing) setDuplicate(existing);
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  function pickDuplicate() {
    if (!duplicate) return;
    leadApi.get(duplicate.id).then(pickLead).catch((e: unknown) => toast((e as Error).message, "error"));
  }

  return (
    <Modal open={open} onClose={onClose} title="Назначить встречу" width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button loading={saving} disabled={saving || !form.client_name || !form.closer_id} onClick={save}>
            Назначить
          </Button>
        </>
      }>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <FormField label="Клоузер" required>
          <Select value={form.closer_id} onChange={set("closer_id")}>
            <option value="">— выбрать —</option>
            {closers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Дата и время" required>
          <Input type="datetime-local" value={form.meeting_date} onChange={set("meeting_date")} />
        </FormField>
      </div>
      {pickMode && form.closer_id && form.meeting_date && (
        <CloserSlots
          closerId={Number(form.closer_id)}
          day={form.meeting_date.slice(0, 10)}
          value={form.meeting_date.slice(11, 16)}
          excludeMeetingId={moved?.id ?? null}
          onPick={(time) => setForm((prev) => ({ ...prev, meeting_date: `${prev.meeting_date.slice(0, 10)}T${time}` }))}
        />
      )}
      {pickMode ? (
        <FormField label="Клиент" required>
          <LeadPicker value={form.client_name} onPick={pickLead} onCreateNew={pickNew} onClear={clearClient} autoFocus />
          {moved && (
            <div role="note" style={{ fontSize: 12, color: "var(--text2)", marginTop: 6 }}>
              Встреча уже назначена на {moved.label} — она будет перенесена.
            </div>
          )}
          {duplicate && (
            <div role="alert" style={{ fontSize: 12, color: "var(--text2)", marginTop: 6 }}>
              Лид с таким номером уже есть{duplicate.client_name ? `: ${duplicate.client_name}` : ""}.{" "}
              <button type="button" onClick={pickDuplicate}
                style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>
                Выбрать его
              </button>
              {" · "}
              <a href={`/leads/${duplicate.id}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                Открыть
              </a>
            </div>
          )}
        </FormField>
      ) : (
        <FormField label="Имя клиента" required>
          <Input value={form.client_name} onChange={set("client_name")} placeholder="ФИО" autoFocus />
        </FormField>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <FormField label="Телефон">
          {/* A picked lead's phone is taken from the lead on the server — show it, don't let it be edited. */}
          <Input value={form.client_phone} onChange={set("client_phone")} placeholder="+996 700 000000"
            readOnly={pickMode && pickedLeadId !== null}
            title={pickMode && pickedLeadId !== null ? "Телефон берётся из карточки лида" : undefined}
            style={pickMode && pickedLeadId !== null ? { background: "var(--bg3)", color: "var(--text2)" } : undefined} />
        </FormField>
        <FormField label="Продолжительность">
          <Select value={form.duration_minutes} onChange={set("duration_minutes")}>
            {MEETING_DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
        </FormField>
      </div>
      {pickMode && (
        <FormField label="Сеттер">
          <Select value={form.setter_id} onChange={set("setter_id")}>
            <option value="">— не указан —</option>
            {users.filter((u) => u.is_active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label="Адрес">
        <Input value={form.address} onChange={set("address")} placeholder="ул. Манаса 45, Zoom…" />
      </FormField>
      <FormField label="Комментарий">
        <Textarea value={form.notes} onChange={set("notes")} rows={2}
          placeholder="Что обсудить, детали для клоузера…" />
      </FormField>
    </Modal>
  );
}

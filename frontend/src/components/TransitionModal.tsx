"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Button, FormField, Input, Select } from "@/components/ui";
import type { LeadStage, User, RejectReason, StageKind, ScheduledMeeting } from "@/lib/types";
import { bishkekDateTimeParts } from "@/lib/format";
import { closerOptions } from "@/lib/roles";
import { CloserSlots } from "@/components/meetings/CloserSlots";

/** Stage behaviour comes from the stored `kind` (backend `LeadStage.kind`). */
export function stageKind(s: Pick<LeadStage, "kind">): StageKind {
  return s.kind ?? "generic";
}

export const STAGE_ACTION_LABELS: Record<string, string> = {
  meeting: "Назначить встречу",
  contract: "Отправить договор",
  waiting_payment: "Ожидание оплаты",
  won: "Провести оплату",
  lost: "Зафиксировать отказ",
  generic: "Перевести этап",
};

function todayBishkek(): string {
  // UTC+6
  const bk = new Date(Date.now() + 6 * 3_600_000);
  return bk.toISOString().slice(0, 10);
}

export interface CardLike {
  client_name: string;
  company_name?: string | null;
  /** Сумма сделки — canonical, comes from the deal. */
  deal_amount?: number;
  paid_amount?: number;
  remaining_amount?: number;
  active_deal?: { amount: number } | null;
  closer_id?: number | null;
  closer?: { id: number; name: string } | null;
  setter_id?: number | null;
  setter?: { id: number; name: string } | null;
  /** Open meeting: re-entering «Встреча» reschedules it instead of creating a new one. */
  scheduled_meeting?: ScheduledMeeting | null;
}

interface TransitionModalProps {
  stage: LeadStage;
  card: CardLike;
  users: User[];
  rejectReasons: RejectReason[];
  onConfirm: (comment: string, extra: Record<string, unknown>) => void | Promise<unknown>;
  onCancel: () => void;
  /** Server error for the last attempt; the form stays open so the user can fix it. */
  error?: string | null;
  busy?: boolean;
  /** Prefilled form values, e.g. reject_reason_id for «Минус — не выходит на связь». */
  defaults?: Record<string, unknown>;
}

function initForm(kind: string, card: CardLike): Record<string, unknown> {
  const dealAmount = card.deal_amount ?? card.active_deal?.amount ?? 0;
  // Default the payment to what is still outstanding, not the whole deal.
  const outstanding = card.remaining_amount ?? dealAmount;
  const closerId = card.closer_id ?? card.closer?.id ?? 0;
  const setterId = card.setter_id ?? card.setter?.id ?? 0;
  switch (kind) {
    case "won":
      return {
        paid_amount: outstanding,
        payment_date: todayBishkek(),
        payment_method: "",
        setter_id: setterId,
        closer_id: closerId,
        deal_type: "from_setter",
      };
    case "contract":
      return {
        amount: dealAmount,
        contract_sent_at: todayBishkek(),
        expected_payment_date: "",
        responsible_id: 0,
      };
    case "waiting_payment":
      return { amount: dealAmount, expected_payment_date: "", responsible_id: 0 };
    case "meeting": {
      const open = card.scheduled_meeting;
      if (open) {
        const { date, time } = bishkekDateTimeParts(open.meeting_date);
        return {
          meeting_date: date, meeting_time: time, address: open.address ?? "", comment: "",
          closer_id: open.closer_id ?? closerId, duration_minutes: open.duration_minutes,
        };
      }
      return { meeting_date: "", meeting_time: "12:00", address: "", comment: "", closer_id: closerId };
    }
    case "lost":
      return { reject_reason_id: 0, reject_comment: "", closer_id: closerId };
    default:
      return {};
  }
}

export function TransitionModal({
  stage,
  card,
  users,
  rejectReasons,
  onConfirm,
  onCancel,
  error,
  busy = false,
  defaults,
}: TransitionModalProps) {
  const kind = stageKind(stage);
  const closers = closerOptions(users, card.closer_id ?? card.closer?.id ?? null);
  const [comment, setComment] = useState("");
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...initForm(kind, card), ...(defaults ?? {}) }));

  function set(key: string, val: unknown) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const extra: Record<string, unknown> = { ...form };
    if (kind === "won") extra.paid_amount = Number(form.paid_amount) || 0;
    if (kind === "contract" || kind === "waiting_payment") extra.amount = Number(form.amount) || 0;
    onConfirm(comment, extra);
  }

  const confirmLabel = STAGE_ACTION_LABELS[kind] ?? "Подтвердить";

  const ta: React.CSSProperties = {
    width: "100%",
    background: "var(--bg-input)",
    border: "0.5px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    color: "var(--text)",
    outline: "none",
    resize: "vertical",
    boxSizing: "border-box",
  };

  return (
    <Modal open title={`Переход: ${stage.name}`} onClose={onCancel} width={500}>
      <form onSubmit={handleSubmit}>
        <div
          style={{
            fontSize: 13,
            color: "var(--text2)",
            padding: "8px 12px",
            background: "var(--bg3)",
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <strong>{card.client_name}</strong>
          {card.company_name ? ` · ${card.company_name}` : ""}
        </div>

        {kind === "meeting" && (
          <>
            {card.scheduled_meeting && (
              <div role="note" style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>
                Встреча уже назначена на {(() => { const p = bishkekDateTimeParts(card.scheduled_meeting.meeting_date); return `${p.date.slice(8, 10)}.${p.date.slice(5, 7)} ${p.time}`; })()} — она будет перенесена.
              </div>
            )}
            <FormField label="Дата встречи" required>
              <Input
                type="date"
                required
                value={String(form.meeting_date ?? "")}
                onChange={(e) => set("meeting_date", e.target.value)}
              />
            </FormField>
            <FormField label="Время">
              <Input
                type="time"
                value={String(form.meeting_time ?? "12:00")}
                onChange={(e) => set("meeting_time", e.target.value)}
              />
            </FormField>
            <FormField label="Адрес / ссылка">
              <Input
                type="text"
                placeholder="Офис, Zoom..."
                value={String(form.address ?? "")}
                onChange={(e) => set("address", e.target.value)}
              />
            </FormField>
            <FormField label="Комментарий">
              <textarea
                style={ta}
                rows={2}
                placeholder="Что обсудить, детали для клоузера…"
                value={String(form.comment ?? "")}
                onChange={(e) => set("comment", e.target.value)}
              />
            </FormField>
            <FormField label="Клоузер" required>
              <Select
                required
                value={String(form.closer_id || "")}
                onChange={(e) => set("closer_id", Number(e.target.value))}
              >
                <option value="">— выбрать —</option>
                {closers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {Number(form.closer_id) > 0 && form.meeting_date ? (
              <CloserSlots
                closerId={Number(form.closer_id)}
                day={String(form.meeting_date)}
                value={String(form.meeting_time ?? "")}
                onPick={(t) => set("meeting_time", t)}
                excludeMeetingId={card.scheduled_meeting?.id ?? null}
              />
            ) : null}
          </>
        )}

        {kind === "contract" && (
          <>
            <FormField label="Сумма сделки" required>
              <Input
                type="number"
                min={0}
                required
                value={String(form.amount ?? "")}
                onChange={(e) => set("amount", Number(e.target.value))}
                suffix="сом"
              />
            </FormField>
            <FormField label="Дата отправки договора">
              <Input
                type="date"
                value={String(form.contract_sent_at ?? "")}
                onChange={(e) => set("contract_sent_at", e.target.value)}
              />
            </FormField>
            <FormField label="Ожидаемая дата оплаты">
              <Input
                type="date"
                value={String(form.expected_payment_date ?? "")}
                onChange={(e) => set("expected_payment_date", e.target.value)}
              />
            </FormField>
            <FormField label="Ответственный">
              <Select
                value={String(form.responsible_id || "")}
                onChange={(e) => set("responsible_id", Number(e.target.value))}
              >
                <option value="">— выбрать —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}

        {kind === "waiting_payment" && (
          <>
            <FormField label="Сумма к оплате">
              <Input
                type="number"
                min={0}
                value={String(form.amount ?? "")}
                onChange={(e) => set("amount", Number(e.target.value))}
                suffix="сом"
              />
            </FormField>
            <FormField label="Ожидаемая дата оплаты">
              <Input
                type="date"
                value={String(form.expected_payment_date ?? "")}
                onChange={(e) => set("expected_payment_date", e.target.value)}
              />
            </FormField>
            <FormField label="Кто дожимает">
              <Select
                value={String(form.responsible_id || "")}
                onChange={(e) => set("responsible_id", Number(e.target.value))}
              >
                <option value="">— выбрать —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}

        {kind === "won" && (
          <>
            {typeof card.remaining_amount === "number" && (
              <div style={{
                fontSize: 12, color: "var(--text2)", background: "var(--bg3)",
                borderRadius: 8, padding: "8px 12px", marginBottom: 12, lineHeight: 1.6,
              }}>
                Сумма сделки: <b>{(card.deal_amount ?? 0).toLocaleString("ru-RU")} сом</b> ·
                {" "}Оплачено: <b>{(card.paid_amount ?? 0).toLocaleString("ru-RU")} сом</b> ·
                {" "}Остаток: <b>{card.remaining_amount.toLocaleString("ru-RU")} сом</b>
                <div style={{ color: "var(--text3)", marginTop: 4 }}>
                  Этап «Оплачено» станет активным только после полной оплаты.
                  Частичная сумма будет сохранена в графике оплат.
                </div>
              </div>
            )}
            <FormField label="Фактическая сумма оплаты" required>
              <Input
                type="number"
                min={0}
                required
                value={String(form.paid_amount ?? "")}
                onChange={(e) => set("paid_amount", Number(e.target.value))}
                suffix="сом"
              />
            </FormField>
            <FormField label="Дата оплаты" required>
              <Input
                type="date"
                required
                value={String(form.payment_date ?? "")}
                onChange={(e) => set("payment_date", e.target.value)}
              />
            </FormField>
            <FormField label="Способ оплаты">
              <Select
                value={String(form.payment_method ?? "")}
                onChange={(e) => set("payment_method", e.target.value)}
              >
                <option value="">— выбрать —</option>
                {["Наличные", "Перевод", "Карта", "Расчётный счёт", "Другое"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Сеттер">
              <Select
                value={String(form.setter_id || "")}
                onChange={(e) => set("setter_id", Number(e.target.value))}
              >
                <option value="">— выбрать —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Клоузер">
              <Select
                value={String(form.closer_id || "")}
                onChange={(e) => set("closer_id", Number(e.target.value))}
              >
                <option value="">— выбрать —</option>
                {closers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Тип сделки">
              <div style={{ display: "flex", gap: 20, paddingTop: 4 }}>
                {[
                  { val: "from_setter", label: "От сеттера" },
                  { val: "closer_self", label: "Самостоятельная клоузера" },
                ].map((opt) => (
                  <label
                    key={opt.val}
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}
                  >
                    <input
                      type="radio"
                      name="deal_type"
                      value={opt.val}
                      checked={form.deal_type === opt.val}
                      onChange={() => set("deal_type", opt.val)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </FormField>
          </>
        )}

        {kind === "lost" && (
          <>
            <FormField label="Причина отказа">
              <Select
                value={String(form.reject_reason_id || "")}
                onChange={(e) => set("reject_reason_id", Number(e.target.value))}
              >
                <option value="">— выбрать —</option>
                {rejectReasons
                  .filter((r) => r.is_active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label="Комментарий">
              <textarea
                style={ta}
                rows={3}
                value={String(form.reject_comment ?? "")}
                onChange={(e) => set("reject_comment", e.target.value)}
              />
            </FormField>
            <FormField label="Кто закрыл">
              <Select
                value={String(form.closer_id || "")}
                onChange={(e) => set("closer_id", Number(e.target.value))}
              >
                <option value="">— выбрать —</option>
                {closers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}

        <FormField label="Комментарий к переходу">
          <Input
            type="text"
            placeholder="Необязательно..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </FormField>

        {error && (
          <div role="alert" style={{ color: "var(--red)", fontSize: 13, margin: "4px 0 12px" }}>{error}</div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

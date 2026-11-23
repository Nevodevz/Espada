"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Button, ConfirmModal } from "@/components/ui";
import { TransitionModal, stageKind, STAGE_ACTION_LABELS } from "@/components/TransitionModal";
import { PaymentScheduleSection } from "@/components/leads/PaymentSchedule";
import { AddActivityModal, AddFileModal } from "@/components/leadcard/LeadModals";
import { InlineField } from "@/components/leadcard/InlineField";
import { LeadFeed } from "@/components/leadcard/LeadFeed";
import { LeadTasksPanel } from "@/components/leadcard/LeadTasksPanel";
import { LeadComposer, type ComposerTab } from "@/components/leadcard/LeadComposer";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { api, leadApi, leadTasksApi, settingsApi, whatsappApi } from "@/lib/api";
import { buildLeadPatch, type LeadEditableField } from "@/lib/leadPatch";
import { closerOptions } from "@/lib/roles";
import { fmtDate, fmtDateTime, fmtMoney, fmtMoneyShort } from "@/lib/format";
import type {
  Account, Department, LeadDetail, LeadSource, LeadStage, LeadTask, PaymentSchedule, Project,
  RejectReason, ServiceItem, UserWithStats,
} from "@/lib/types";
import { DEAL_STATUS } from "@/lib/types";

const UNREACHABLE_REASON = "Не выходит на связь";

// ── small building blocks ────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
      <span style={{ color: "var(--text3)" }}>{label}</span>
      <span style={{ textAlign: "right", color: "var(--text1)" }}>{children || <span style={{ color: "var(--text3)" }}>—</span>}</span>
    </div>
  );
}

function Fold({ title, children, defaultOpen = false, action }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          style={{ background: "none", border: "none", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600, color: "var(--text1)", padding: "2px 0" }}>
          {open ? "▾" : "▸"} {title}
        </button>
        {action}
      </div>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

function StageStrip({ stages, currentId, onPick }: { stages: LeadStage[]; currentId: number | null; onPick: (s: LeadStage) => void }) {
  const currentIdx = stages.findIndex((s) => s.id === currentId);
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }}>
      {stages.map((s, i) => {
        const current = s.id === currentId;
        const past = currentIdx >= 0 && i < currentIdx;
        return (
          <button key={s.id} type="button" disabled={current} onClick={() => onPick(s)}
            title={current ? "Текущий этап" : `Перевести: ${s.name}`}
            style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 12, font: "inherit", cursor: current ? "default" : "pointer",
              border: `1px solid ${current ? s.color : "var(--border)"}`,
              background: current ? s.color : past ? s.color + "22" : "transparent",
              color: current ? "#fff" : "var(--text2)", fontWeight: current ? 700 : 400,
            }}>
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

function MoreMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>⋯</Button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setOpen(false)} />
          <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 51, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, minWidth: 200, boxShadow: "var(--shadow-md)", padding: "4px 0" }}>
            {items.map((it) => (
              <button key={it.label} role="menuitem" type="button" onClick={() => { setOpen(false); it.onClick(); }}
                style={{ width: "100%", padding: "8px 14px", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontSize: 13, color: it.danger ? "var(--red)" : "var(--text)", font: "inherit" }}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StagePicker({ stages, currentId, onPick }: { stages: LeadStage[]; currentId: number | null; onPick: (s: LeadStage) => void }) {
  return (
    <select className="form-input" style={{ width: "auto" }} value="" aria-label="Перевести на этап"
      onChange={(e) => { const s = stages.find((x) => x.id === Number(e.target.value)); if (s) onPick(s); }}>
      <option value="" disabled>Перевести ▾</option>
      {stages.filter((s) => s.id !== currentId).map((s) => {
        const k = stageKind(s);
        return <option key={s.id} value={s.id}>{k === "generic" ? `→ ${s.name}` : `${STAGE_ACTION_LABELS[k]} (${s.name})`}</option>;
      })}
    </select>
  );
}

// ── page ─────────────────────────────────────────────────────────
export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const leadId = Number(id);
  const router = useRouter();
  const toast = useToast();
  const { isAdmin, user } = useApp();

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rejectReasons, setRejectReasons] = useState<RejectReason[]>([]);
  const [linkedProject, setLinkedProject] = useState<Project | null>(null);
  const [schedule, setSchedule] = useState<PaymentSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canWork, setCanWork] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<ComposerTab | null>(null);

  const [actModal, setActModal] = useState(false);
  const [fileModal, setFileModal] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [ignoreConfirm, setIgnoreConfirm] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<number | null>(null);
  const [transition, setTransition] = useState<{ stage: LeadStage; defaults?: Record<string, unknown> } | null>(null);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setScheduleError(null);
    try { setSchedule(await leadApi.payments(leadId)); }
    catch (e: unknown) { setScheduleError((e as Error).message || "Не удалось загрузить график оплат"); }
    finally { setScheduleLoading(false); }
  }, [leadId]);

  const reload = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([leadApi.get(leadId), leadTasksApi.list(leadId).catch(() => [] as LeadTask[])]);
      setLead(d);
      setTasks(t);
      api.listProjects().then((prjs) => setLinkedProject(prjs.find((p) => p.lead_id === d.id) ?? null)).catch(() => {});
    } catch {
      toast("Лид не найден", "error");
      router.push("/leads");
    }
    setLoading(false);
    setRefreshKey((k) => k + 1);
    loadSchedule();
  }, [leadId, loadSchedule, router, toast]);

  useEffect(() => {
    settingsApi.listStages().then(setStages).catch(() => {});
    settingsApi.listSources().then(setSources).catch(() => {});
    settingsApi.listServices().then(setServices).catch(() => {});
    settingsApi.listRejectReasons().then(setRejectReasons).catch(() => {});
    settingsApi.listAccounts().then(setAccounts).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
    api.listDepartments().then(setDepartments).catch(() => {});
    whatsappApi.access().then((r) => setCanWork(r.can_use)).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Who can be given a task: the same circle the backend accepts (sales dept, closers, admins).
  const assignees = useMemo(() => {
    const salesId = departments.find((d) => d.slug === "sales")?.id;
    return users.filter((u) => u.is_active && (u.role === "admin" || u.is_founder || u.is_closer
      || (salesId !== undefined && u.department_ids?.includes(salesId))));
  }, [users, departments]);

  if (loading) return <Shell title="Лид"><div style={{ padding: 40, color: "var(--text3)", textAlign: "center" }}>Загрузка…</div></Shell>;
  if (!lead) return null;

  const activeStages = stages.filter((s) => !s.is_archived);
  const kind = lead.stage ? stageKind(lead.stage) : "generic";
  const leadOpen = lead.status === "active" && kind !== "won" && kind !== "lost";
  const wonStage = activeStages.find((s) => stageKind(s) === "won");
  const lostStage = activeStages.find((s) => stageKind(s) === "lost");
  const showPay = (kind === "waiting_payment" || kind === "contract") && wonStage;
  const dealStatus = DEAL_STATUS[lead.deal_status] ?? DEAL_STATUS.pending;
  const canManagePayments = isAdmin || !!user?.is_founder || user?.position === "Финансовый директор"
    || user?.id === lead.setter_id || user?.id === lead.closer_id;
  const activeTab: ComposerTab = tab ?? (canWork && lead.whatsapp_chat_id ? "whatsapp" : "task");
  const streak = lead.no_answer_streak ?? 0;

  // Inline edit: one field per PATCH, then reload so derived values (deal status, etc.) refresh.
  // Errors (e.g. 422 «сумма ниже графика оплат») are toasted and rethrown so the field reverts.
  const saveField = (field: LeadEditableField) => async (raw: string) => {
    try {
      await leadApi.update(lead!.id, buildLeadPatch(field, raw));
      await reload();
      toast("Сохранено", "success");
    } catch (e: unknown) {
      toast((e as Error).message || "Не удалось сохранить", "error");
      throw e;
    }
  };
  const txt = (field: LeadEditableField, label: string, display?: React.ReactNode) => (
    <InlineField label={label} value={String((lead as unknown as Record<string, unknown>)[field] ?? "")} display={display} onSave={saveField(field)} />
  );
  const idOf = (v: number | null | undefined) => (v != null ? String(v) : "");
  const sourceOpts = sources.map((s) => ({ value: String(s.id), label: s.name }));
  const serviceOpts = services.map((s) => ({ value: String(s.id), label: s.name }));
  const userOpts = users.map((u) => ({ value: String(u.id), label: u.name }));
  const closerOpts = closerOptions(users, lead.closer_id).map((u) => ({ value: String(u.id), label: u.name }));
  const dealAmountField = (
    <InlineField label="Сумма сделки" kind="number" value={lead.deal_amount > 0 ? String(lead.deal_amount) : ""}
      display={lead.deal_amount > 0 ? fmtMoney(lead.deal_amount) : null} onSave={saveField("deal_amount")} />
  );

  async function handleTransitionConfirm(comment: string, extra: Record<string, unknown>) {
    if (!transition) return;
    try {
      await leadApi.changeStage(lead!.id, transition.stage.id, comment, extra);
      toast(stageKind(transition.stage) === "won" ? "Оплата проведена" : `Этап → «${transition.stage.name}»`, "success");
      setTransition(null);
      reload();
    } catch (e: unknown) {
      toast((e as Error).message || "Ошибка смены этапа", "error");
      if (stageKind(transition.stage) === "won") { setTransition(null); reload(); } // partial payment is recorded
    }
  }

  function suggestLost() {
    if (!lostStage) return;
    const reason = rejectReasons.find((r) => r.name === UNREACHABLE_REASON);
    setTransition({ stage: lostStage, defaults: reason ? { reject_reason_id: reason.id } : undefined });
  }

  const card = (
    <div className="card" style={{ padding: "16px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: "var(--text1)" }}>
              <InlineField bare label="Имя клиента" value={lead.client_name} onSave={saveField("client_name")} />
            </span>
            <span style={{ color: "var(--text3)" }}>
              <InlineField bare label="Компания" value={lead.company_name} placeholder="компания…" onSave={saveField("company_name")} />
            </span>
            {lead.status === "archived" && <span style={{ padding: "2px 8px", borderRadius: 8, background: "var(--bg3)", color: "var(--text3)", fontSize: 11 }}>Архив</span>}
          </div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <InlineField bare label="Телефон" value={lead.phone} placeholder="добавить телефон…" onSave={saveField("phone")} />
            <InlineField bare label="WhatsApp" value={lead.whatsapp} display={lead.whatsapp ? `WhatsApp ${lead.whatsapp}` : null}
              placeholder="добавить WhatsApp…" onSave={saveField("whatsapp")} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {showPay && wonStage && <Button size="sm" icon="payments" onClick={() => setTransition({ stage: wonStage })}>Провести оплату</Button>}
          <StagePicker stages={activeStages} currentId={lead.stage_id} onPick={(s) => setTransition({ stage: s })} />
          <MoreMenu items={[
            { label: "Добавить касание", onClick: () => setActModal(true) },
            { label: "Добавить файл / ссылку", onClick: () => setFileModal(true) },
            ...(canWork && lead.whatsapp_chat_id ? [{ label: "Не лид (WhatsApp)", onClick: () => setIgnoreConfirm(true) }] : []),
            { label: "Архив", onClick: () => setArchiveConfirm(true), danger: true },
          ]} />
        </div>
      </div>
      <StageStrip stages={activeStages} currentId={lead.stage_id} onPick={(s) => setTransition({ stage: s })} />
    </div>
  );

  const left = (
    <div className="card lead-left" style={{ padding: "14px 16px" }}>
      <InlineField label="Сеттер" kind="select" value={idOf(lead.setter_id)} options={userOpts} onSave={saveField("setter_id")}
        display={lead.setter?.name ?? (canWork ? (
          <Button size="sm" variant="ghost" onClick={async () => {
            try { await whatsappApi.take(lead.id); toast("Лид назначен на вас", "success"); }
            catch (e: unknown) { toast((e as Error).message, "error"); }
            reload();
          }}>Взять себе</Button>
        ) : null)} />
      <InlineField label="Клоузер" kind="select" value={idOf(lead.closer_id)} options={closerOpts} display={lead.closer?.name} onSave={saveField("closer_id")} />
      <InlineField label="Источник" kind="select" value={idOf(lead.source_id)} options={sourceOpts} display={lead.source?.name} onSave={saveField("source_id")} />
      <InlineField label="Услуга" kind="select" value={idOf(lead.service_id)} options={serviceOpts} display={lead.service?.name} onSave={saveField("service_id")} />
      {dealAmountField}
      {lead.deal_amount > 0 && <Field label="Оплачено / остаток">{fmtMoneyShort(lead.paid_amount)} / {fmtMoneyShort(lead.remaining_amount)}</Field>}
      {streak > 0 && <Field label="Недозвоны подряд"><span style={{ color: "var(--red)" }}>📵×{streak}</span></Field>}
      <InlineField label="Комментарий" kind="textarea" value={lead.comment} onSave={saveField("comment")} />

      <Fold title="Контакты и атрибуция">
        {txt("instagram", "Instagram")}
        {txt("email", "Email")}
        {txt("address", "Адрес")}
        {txt("website", "Сайт", lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">{lead.website}</a> : null)}
        {txt("industry", "Отрасль")}
        <InlineField label="Сотрудников" kind="number" value={lead.employees_count != null ? String(lead.employees_count) : ""} onSave={saveField("employees_count")} />
        {txt("source_detail", "Уточнение источника")}
        {txt("content_ref", "Рилс / контент")}
        {txt("utm_source", "UTM source")}
        {txt("utm_medium", "UTM medium")}
        {txt("utm_campaign", "UTM campaign")}
        {txt("utm_content", "UTM content")}
        {txt("external_lead_id", "Внешний ID лида")}
        <Field label="Создан">{fmtDate(lead.created_at)}</Field>
        <Field label="Обновлён">{fmtDate(lead.updated_at)}</Field>
      </Fold>

      <Fold title={`Финансы и график оплат${lead.deal_amount > 0 ? ` · ${dealStatus.label}` : ""}`}>
        {dealAmountField}
        <Field label="Оплачено">{fmtMoney(lead.paid_amount)}</Field>
        <Field label="Остаток">{fmtMoney(lead.remaining_amount)}</Field>
        {lead.active_deal && (
          <>
            <Field label="Способ последней оплаты">{lead.active_deal.payment_method}</Field>
            <Field label="Дата последней оплаты">{lead.active_deal.payment_date ? fmtDate(lead.active_deal.payment_date) : null}</Field>
          </>
        )}
        {lead.active_deal && lead.deal_status === "paid" && (
          <>
            <Field label="Комиссия сеттера">{fmtMoney(lead.active_deal.setter_commission)}</Field>
            <Field label="Комиссия клоузера">{fmtMoney(lead.active_deal.closer_commission)}</Field>
            <Field label="Маржа">{(() => {
              const d = lead.active_deal!;
              const margin = d.paid_amount - d.setter_commission - d.closer_commission;
              return <span style={{ color: margin >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{fmtMoney(margin)}</span>;
            })()}</Field>
          </>
        )}
        <div style={{ marginTop: 10 }}>
          <PaymentScheduleSection leadId={lead.id} schedule={schedule} accounts={accounts} canManage={canManagePayments}
            loading={scheduleLoading} error={scheduleError} onChanged={(next) => { setSchedule(next); reload(); }} onRetry={loadSchedule} />
        </div>
      </Fold>

      <Fold title={`Встречи (${lead.meetings.length})`}>
        {lead.meetings.length === 0 && <div style={{ color: "var(--text3)", fontSize: 13 }}>Встреч нет</div>}
        {lead.meetings.map((m) => (
          <div key={m.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
            {fmtDateTime(m.meeting_date)} · {m.closer?.name || "—"}
          </div>
        ))}
      </Fold>

      <Fold title={`Файлы (${lead.files.length})`} action={<Button size="sm" variant="ghost" onClick={() => setFileModal(true)}>+</Button>}>
        {lead.files.length === 0 && <div style={{ color: "var(--text3)", fontSize: 13 }}>Файлов нет</div>}
        {lead.files.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
            <a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{f.name}</a>
            <span style={{ color: "var(--text3)", fontSize: 11 }}>{fmtDate(f.created_at)}</span>
            <button type="button" aria-label={`Удалить файл ${f.name}`} onClick={() => setDeleteFileId(f.id)}
              style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text3)" }}>✕</button>
          </div>
        ))}
      </Fold>

      {linkedProject && (
        <Fold title="Проект в разработке">
          <div style={{ fontSize: 13 }}>
            <b>{linkedProject.company}</b> · {linkedProject.sub_status || "Без подстатуса"}
            {linkedProject.bot_comment ? ` · ${linkedProject.bot_comment}` : ""}{" "}
            <Link href="/dept/dev">Открыть</Link>
          </div>
        </Fold>
      )}

      {lead.tasks.length > 0 && (
        <Fold title={`Личные задачи сотрудников (${lead.tasks.length})`}>
          {lead.tasks.map((t) => (
            <div key={t.id} style={{ fontSize: 13, padding: "4px 0", color: t.completed_at ? "var(--text3)" : "var(--text1)" }}>
              {t.title} · {t.owner?.name || "—"}{t.due_date ? ` · до ${fmtDate(t.due_date)}` : ""}
            </div>
          ))}
        </Fold>
      )}
    </div>
  );

  const right = (
    <div className="card lead-right" style={{ padding: "14px 16px", display: "flex", flexDirection: "column" }}>
      <LeadTasksPanel leadId={lead.id} tasks={tasks} leadOpen={leadOpen} canWork={canWork} onChanged={reload}
        onSuggestLost={suggestLost} onChangeStage={() => document.querySelector<HTMLSelectElement>("select[aria-label='Перевести на этап']")?.focus()}
        onPlanTask={() => setTab("task")} />
      <LeadFeed leadId={lead.id} refreshKey={refreshKey} />
      {canWork && (
        <LeadComposer leadId={lead.id} canWhatsApp={canWork} tab={activeTab} onTab={setTab}
          assignees={assignees} currentUserId={user?.id} onSent={reload} />
      )}
    </div>
  );

  return (
    <Shell title={lead.client_name}>
      {card}
      <div className="lead-layout">
        <div className="lead-col-right">{right}</div>
        <div className="lead-col-left">{left}</div>
      </div>

      {actModal && <AddActivityModal leadId={lead.id} users={users} onClose={() => setActModal(false)} onAdded={reload} />}
      {fileModal && <AddFileModal leadId={lead.id} onClose={() => setFileModal(false)} onAdded={reload} />}
      {transition && (
        <TransitionModal stage={transition.stage} defaults={transition.defaults}
          card={{
            client_name: lead.client_name, company_name: lead.company_name, deal_amount: lead.deal_amount,
            paid_amount: lead.paid_amount, remaining_amount: lead.remaining_amount, active_deal: lead.active_deal,
            closer_id: lead.closer_id, closer: lead.closer, setter_id: lead.setter_id, setter: lead.setter,
            scheduled_meeting: lead.scheduled_meeting,
          }}
          users={users} rejectReasons={rejectReasons} onConfirm={handleTransitionConfirm} onCancel={() => setTransition(null)} />
      )}
      <ConfirmModal open={ignoreConfirm} title="Это не лид?" variant="danger" confirmLabel="Не лид"
        message="Номер помечается как «Не лид»: новые сообщения с него не будут создавать лиды. Если этот лид создан автоматически из WhatsApp, он уйдёт в архив."
        onCancel={() => setIgnoreConfirm(false)}
        onConfirm={async () => {
          setIgnoreConfirm(false);
          if (!lead.whatsapp_chat_id) return;
          try { await whatsappApi.ignore(lead.whatsapp_chat_id); toast("Номер помечен «Не лид»", "success"); reload(); }
          catch (e: unknown) { toast((e as Error).message, "error"); }
        }} />
      <ConfirmModal open={archiveConfirm} title="Архивировать лид" variant="danger" confirmLabel="Архивировать"
        message="Лид будет перемещён в архив, открытые задачи по нему закроются. Данные сохранятся."
        onCancel={() => setArchiveConfirm(false)}
        onConfirm={async () => {
          setArchiveConfirm(false);
          try { await leadApi.archive(lead.id); toast("Лид архивирован", "success"); router.push("/leads"); }
          catch (e: unknown) { toast((e as Error).message, "error"); }
        }} />
      <ConfirmModal open={deleteFileId !== null} title="Удалить файл" variant="danger" confirmLabel="Удалить"
        message="Файл будет удалён без возможности восстановления."
        onCancel={() => setDeleteFileId(null)}
        onConfirm={async () => {
          const fid = deleteFileId!;
          setDeleteFileId(null);
          try { await leadApi.deleteFile(lead.id, fid); toast("Файл удалён", "success"); reload(); }
          catch (e: unknown) { toast((e as Error).message, "error"); }
        }} />

      <style jsx global>{`
        .lead-layout { display: grid; grid-template-columns: minmax(260px, 35%) 1fr; gap: 14px; align-items: start; }
        .lead-col-left { grid-column: 1; grid-row: 1; }
        .lead-col-right { grid-column: 2; grid-row: 1; min-width: 0; }
        @media (max-width: 900px) {
          .lead-layout { grid-template-columns: 1fr; }
          .lead-col-left, .lead-col-right { grid-column: 1; grid-row: auto; }
        }
        .inline-field-pencil { opacity: 0; transition: opacity .12s; }
        .inline-field:hover .inline-field-pencil, .inline-field-pencil:focus-visible { opacity: 1; }
        @media (hover: none) { .inline-field-pencil { opacity: 1; } }
        .form-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text2); font-weight: 500; }
        .form-input { background: var(--bg3); border: 1px solid var(--border); border-radius: 7px; padding: 7px 10px; font-size: 13px; color: var(--text); font-family: inherit; outline: none; width: 100%; box-sizing: border-box; }
        .form-input:focus { border-color: var(--primary); }
        .btn { padding: 8px 14px; border-radius: 7px; font-size: 13px; font-family: inherit; cursor: pointer; border: none; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }
        .btn-ghost { background: var(--bg3); color: var(--text2); border: 1px solid var(--border); }
      `}</style>
    </Shell>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { leadTasksApi } from "@/lib/api";
import { fmtDateTime, localInputToUtc, utcToLocalInput } from "@/lib/format";
import { QUICK_DUE_LABELS, TASK_KIND_ICONS, TASK_KIND_LABELS, isOverdue, quickDue, reloadAfterResult, type QuickDue } from "@/lib/leadTasks";
import type { LeadTask } from "@/lib/types";

type After =
  | { kind: "callback"; taskKind: LeadTask["kind"]; suggestLost: boolean; streak: number }
  | { kind: "next" };

function QuickTimes({ onPick }: { onPick: (iso: string) => void }) {
  const [custom, setCustom] = useState("");
  const now = new Date();
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {(Object.keys(QUICK_DUE_LABELS) as Exclude<QuickDue, "callback">[]).map((k) => {
        const due = quickDue(k, now);
        return due ? <Button key={k} size="sm" variant="ghost" onClick={() => onPick(due.toISOString())}>{QUICK_DUE_LABELS[k]}</Button> : null;
      })}
      <input type="datetime-local" className="form-input" style={{ width: 190 }} value={custom}
        min={utcToLocalInput(now.toISOString())} onChange={(e) => setCustom(e.target.value)} />
      <Button size="sm" disabled={!custom} onClick={() => onPick(localInputToUtc(custom))}>ОК</Button>
    </div>
  );
}

function TaskRow({ task, onDone }: {
  task: LeadTask; onDone: (after: After | null) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"idle" | "connected" | "reschedule">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const overdue = isOverdue(task, new Date());

  async function run(action: () => Promise<unknown>, after: (res: any) => After | null) {
    setBusy(true);
    try {
      const res = await action();
      onDone(after(res));
    } catch (e: unknown) {
      toast((e as Error).message || "Не удалось сохранить", "error");
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      borderLeft: `3px solid ${overdue ? "var(--red)" : "var(--yellow)"}`, background: overdue ? "var(--red-bg, #fdeeee)" : "var(--yellow-bg, #fff8e6)",
      borderRadius: 8, padding: "8px 10px", marginBottom: 8,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13 }}>
        <b>{TASK_KIND_ICONS[task.kind]} {TASK_KIND_LABELS[task.kind]}</b>
        <span style={{ color: overdue ? "var(--red)" : "var(--text2)" }}>{fmtDateTime(task.due_at)}{overdue ? " · просрочено" : ""}</span>
        <span style={{ color: "var(--text3)" }}>{task.assignee ? task.assignee.name : "без ответственного"}</span>
      </div>
      {task.comment && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{task.comment}</div>}

      {task.can_edit && mode === "idle" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {task.kind === "call" ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => setMode("connected")}>✅ Дозвонился</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => run(
                () => leadTasksApi.complete(task.id, "no_answer"),
                (r) => ({ kind: "callback", taskKind: task.kind, suggestLost: r.suggest_lost, streak: r.no_answer_streak }),
              )}>📵 Недозвон</Button>
            </>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => run(() => leadTasksApi.complete(task.id, "done"), () => ({ kind: "next" }))}>✔ Выполнено</Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("reschedule")}>🕒 Перенести</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => leadTasksApi.cancel(task.id), () => null)}>Отменить</Button>
        </div>
      )}
      {mode === "connected" && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <input className="form-input" style={{ flex: 1, minWidth: 180 }} autoFocus placeholder="Итог звонка (необязательно)"
            value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => run(() => leadTasksApi.complete(task.id, "connected", note.trim()), () => ({ kind: "next" }))}>Сохранить</Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Отмена</Button>
        </div>
      )}
      {mode === "reschedule" && (
        <div style={{ marginTop: 8 }}>
          <QuickTimes onPick={(iso) => run(() => leadTasksApi.reschedule(task.id, iso), () => null)} />
          <Button size="sm" variant="ghost" onClick={() => setMode("idle")} style={{ marginTop: 6 }}>Отмена</Button>
        </div>
      )}
    </div>
  );
}

/** Open tasks pinned above the feed, plus the AmoCRM-style follow-ups after a result. */
export function LeadTasksPanel({ leadId, tasks, leadOpen, canWork, onChanged, onSuggestLost, onChangeStage, onPlanTask, deferReload = false }: {
  leadId: number;
  tasks: LeadTask[];
  /** Lead is active and not won/lost — only then «Нет задачи» matters. */
  leadOpen: boolean;
  canWork: boolean;
  onChanged: () => void;
  onSuggestLost: () => void;
  onChangeStage: () => void;
  onPlanTask: () => void;
  /** «Мои задачи»: completed tasks leave the list — keep the follow-up on screen until answered. */
  deferReload?: boolean;
}) {
  const toast = useToast();
  const [after, setAfterState] = useState<After | null>(null);
  const [pickTime, setPickTime] = useState(false);
  const [pending, setPending] = useState(false);
  const [doneIds, setDoneIds] = useState<number[]>([]);

  /** Close (or open) the follow-up; a reload postponed for it happens when it closes. */
  function setAfter(next: After | null) {
    setAfterState(next);
    if (next === null && pending) { setPending(false); onChanged(); }
  }

  function handleDone(taskId: number, next: After | null) {
    setDoneIds((ids) => [...ids, taskId]);
    setAfterState(next);
    if (reloadAfterResult(next, deferReload)) onChanged();
    else setPending(true);
  }

  async function createCallback(iso: string, kind: LeadTask["kind"]) {
    try {
      await leadTasksApi.create(leadId, { kind, due_at: iso, comment: "Перезвонить" });
      toast("Задача поставлена", "success");
      setPickTime(false);
      setAfterState(null);
      setPending(false);
      onChanged();
    } catch (e: unknown) { toast((e as Error).message, "error"); }
  }

  return (
    <div>
      {after?.kind === "callback" && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", marginBottom: 8, fontSize: 13, background: "var(--bg2)" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span>Поставить: 📞 Перезвонить · через 2 часа</span>
            <Button size="sm" onClick={() => createCallback(quickDue("callback", new Date())!.toISOString(), after.taskKind)}>Поставить</Button>
            <Button size="sm" variant="ghost" onClick={() => setPickTime((v) => !v)}>другое время</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAfter(null); setPickTime(false); }}>не надо</Button>
          </div>
          {pickTime && <div style={{ marginTop: 8 }}><QuickTimes onPick={(iso) => createCallback(iso, after.taskKind)} /></div>}
          {after.suggestLost && (
            <div style={{ marginTop: 8, color: "var(--red)" }}>
              {after.streak} недозвонов подряд — перевести в «Минус» (не выходит на связь)?{" "}
              <Button size="sm" variant="danger" onClick={() => { setAfter(null); onSuggestLost(); }}>Перевести</Button>
            </div>
          )}
        </div>
      )}
      {after?.kind === "next" && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", marginBottom: 8, fontSize: 13, background: "var(--bg2)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span>Следующий шаг:</span>
          <Button size="sm" variant="ghost" onClick={() => { setAfter(null); onChangeStage(); }}>сменить этап</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAfter(null); onPlanTask(); }}>поставить задачу</Button>
          <Button size="sm" variant="ghost" onClick={() => setAfter(null)}>✕</Button>
        </div>
      )}
      {tasks.filter((t) => !doneIds.includes(t.id)).map((t) => <TaskRow key={t.id} task={t} onDone={(next) => handleDone(t.id, next)} />)}
      {leadOpen && canWork && tasks.length === 0 && !after && (
        <div style={{ background: "var(--yellow-bg, #fff8e6)", border: "1px solid var(--yellow)", borderRadius: 8, padding: "8px 10px", marginBottom: 8, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
          ⚠️ Нет следующей задачи — поставьте
          <Button size="sm" onClick={onPlanTask}>Поставить задачу</Button>
        </div>
      )}
    </div>
  );
}

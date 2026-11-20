"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Button, Card } from "@/components/ui";
import { LeadTasksPanel } from "@/components/leadcard/LeadTasksPanel";
import { useApp } from "@/context/AppContext";
import { api, leadTasksApi } from "@/lib/api";
import { groupMyTasks } from "@/lib/leadTasks";
import type { LeadTask, UserWithStats } from "@/lib/types";

const POLL_MS = 60_000;

function Group({ title, color, tasks, onChanged, assignees }: {
  title: string; color: string; tasks: LeadTask[]; onChanged: () => void;
  /** Offered for tasks without an assignee (managers only). */
  assignees?: UserWithStats[];
}) {
  const router = useRouter();
  if (!tasks.length) return null;
  return (
    <Card padding="16px 18px" style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color, marginBottom: 10 }}>{title} · {tasks.length}</div>
      {tasks.map((task) => (
        <div key={task.id} style={{ marginBottom: 6 }}>
          <Link href={`/leads/${task.lead_id}`} style={{ fontSize: 13, fontWeight: 600 }}>{task.lead_name}</Link>
          {assignees && !task.assignee && (
            <select className="form-input" style={{ width: 220, marginLeft: 10, display: "inline-block" }} value="" aria-label="Назначить ответственного"
              onChange={async (e) => { if (e.target.value) { await leadTasksApi.assign(task.id, Number(e.target.value)).catch(() => {}); onChanged(); } }}>
              <option value="">Назначить ответственного…</option>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <div style={{ marginTop: 4 }}>
            <LeadTasksPanel leadId={task.lead_id} tasks={[task]} leadOpen={false} canWork onChanged={onChanged} deferReload
              onSuggestLost={() => router.push(`/leads/${task.lead_id}`)}
              onChangeStage={() => router.push(`/leads/${task.lead_id}`)}
              onPlanTask={() => router.push(`/leads/${task.lead_id}`)} />
          </div>
        </div>
      ))}
    </Card>
  );
}

function MyTasksInner() {
  const { isAdmin, user } = useApp();
  const searchParams = useSearchParams();
  const manager = isAdmin || !!user?.is_founder;
  const [assignee, setAssignee] = useState(searchParams.get("assignee") || "me");
  const [tasks, setTasks] = useState<LeadTask[] | null>(null);
  const [unassigned, setUnassigned] = useState<LeadTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserWithStats[]>([]);

  const load = useCallback(async () => {
    try {
      setTasks(await leadTasksApi.mine("all", assignee));
      // Managers always see tasks nobody owns (left employee, migrated tasks) — spec §5.1.
      setUnassigned(manager && assignee === "me" ? await leadTasksApi.mine("all", "none") : []);
      setError(null);
    } catch (e: unknown) { setError((e as Error).message || "Не удалось загрузить задачи"); }
  }, [assignee, manager]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => { if (manager) api.listUsers().then(setUsers).catch(() => {}); }, [manager]);

  const groups = useMemo(() => groupMyTasks(tasks ?? [], new Date()), [tasks]);

  return (
    <Shell title="Мои задачи">
      <div className="page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="page-h1">Мои задачи</div>
          <div className="page-desc">Звонки и следующие шаги по лидам — просроченные сверху</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {manager && (
            <select className="form-input" style={{ width: 220 }} value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Ответственный">
              <option value="me">Мои</option>
              <option value="all">Все сотрудники</option>
              <option value="none">Без ответственного</option>
              {users.filter((u) => u.is_active && u.id !== user?.id).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
          )}
          <Button variant="ghost" icon="refresh" onClick={load}>Обновить</Button>
        </div>
      </div>
      {error && <Card padding="16px" style={{ marginBottom: 14, color: "var(--red)" }}>{error}</Card>}
      {tasks === null && !error && <div style={{ padding: 30, color: "var(--text3)" }}>Загрузка…</div>}
      {tasks !== null && tasks.length === 0 && (
        <Card padding="24px" style={{ textAlign: "center", color: "var(--text3)" }}>Открытых задач нет. Поставьте следующий шаг в карточке лида.</Card>
      )}
      <Group title="Без ответственного" color="var(--yellow)" tasks={unassigned} onChanged={load} assignees={users.filter((u) => u.is_active)} />
      {assignee === "none" && <Group title="Без ответственного" color="var(--yellow)" tasks={tasks ?? []} onChanged={load} assignees={users.filter((u) => u.is_active)} />}
      <Group title="Просрочено" color="var(--red)" tasks={assignee === "none" ? [] : groups.overdue} onChanged={load} />
      <Group title="Сегодня" color="var(--text1)" tasks={assignee === "none" ? [] : groups.today} onChanged={load} />
      <Group title="Завтра и позже" color="var(--text2)" tasks={assignee === "none" ? [] : groups.later} onChanged={load} />
      <style jsx global>{`
        .form-input { background: var(--bg3); border: 1px solid var(--border); border-radius: 7px; padding: 7px 10px; font-size: 13px; color: var(--text); font-family: inherit; outline: none; width: 100%; box-sizing: border-box; }
      `}</style>
    </Shell>
  );
}

export default function MyTasksPage() {
  return <Suspense fallback={<Shell title="Мои задачи"><div style={{ padding: 30 }}>Загрузка…</div></Shell>}><MyTasksInner /></Suspense>;
}

import type { LeadTask, LeadTaskKind } from "./types";

const BISHKEK_MS = 6 * 3600 * 1000;
const MIN = 60 * 1000;

export const TASK_KIND_LABELS: Record<LeadTaskKind, string> = {
  call: "Позвонить",
  message: "Написать",
  meeting: "Встреча",
  other: "Другое",
};

export const TASK_KIND_ICONS: Record<LeadTaskKind, string> = {
  call: "📞",
  message: "💬",
  meeting: "🤝",
  other: "📌",
};

export type QuickDue = "15m" | "1h" | "evening" | "tomorrow" | "callback";

export const QUICK_DUE_LABELS: Record<Exclude<QuickDue, "callback">, string> = {
  "15m": "через 15 мин",
  "1h": "через 1 час",
  evening: "сегодня вечером",
  tomorrow: "завтра утром",
};

/** Bishkek wall clock as a UTC-based Date whose getUTC* fields are local values. */
function bishkekClock(now: Date): Date {
  return new Date(now.getTime() + BISHKEK_MS);
}

/** UTC instant of a Bishkek wall-clock time `daysAhead` days from `now`'s Bishkek date. */
function bishkekAt(now: Date, daysAhead: number, hour: number): Date {
  const local = bishkekClock(now);
  const utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysAhead, hour, 0, 0);
  return new Date(utc - BISHKEK_MS);
}

/** Quick due times from the spec; «сегодня вечером» is unavailable from 18:00 Bishkek on. */
export function quickDue(choice: QuickDue, now: Date): Date | null {
  switch (choice) {
    case "15m": return new Date(now.getTime() + 15 * MIN);
    case "1h": return new Date(now.getTime() + 60 * MIN);
    case "callback": return new Date(now.getTime() + 120 * MIN);
    case "evening": return bishkekClock(now).getUTCHours() >= 18 ? null : bishkekAt(now, 0, 18);
    case "tomorrow": return bishkekAt(now, 1, 10);
  }
}

export function isOverdue(task: Pick<LeadTask, "status" | "due_at">, now: Date): boolean {
  return task.status === "open" && Date.parse(task.due_at) < now.getTime();
}

/** «Мои задачи»: overdue / due later today (Bishkek) / tomorrow and later. */
export function groupMyTasks<T extends Pick<LeadTask, "status" | "due_at">>(tasks: T[], now: Date) {
  const endOfToday = bishkekAt(now, 1, 0).getTime();
  const overdue: T[] = [], today: T[] = [], later: T[] = [];
  for (const task of tasks) {
    const due = Date.parse(task.due_at);
    if (due < now.getTime()) overdue.push(task);
    else if (due < endOfToday) today.push(task);
    else later.push(task);
  }
  return { overdue, today, later };
}

/**
 * After a task result: reload the list now, unless the page drops completed tasks (deferReload,
 * «Мои задачи») and a follow-up offer is open — reloading would unmount it before it is answered.
 */
export function reloadAfterResult(after: { kind: string } | null, deferReload: boolean): boolean {
  return !deferReload || after === null;
}

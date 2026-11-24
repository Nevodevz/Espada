export type WaitingLevel = "gray" | "yellow" | "red";

/** Working minutes → «4 мин», «1 ч 10 мин», «2 дн» (a working day is 540 min, 10:00–19:00). */
export function formatWaitingMinutes(min: number): string {
  if (min >= 540) return `${Math.floor(min / 540)} дн`;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  return `${min} мин`;
}

export function waitingLevel(min: number): WaitingLevel {
  if (min > 60) return "red";
  if (min >= 15) return "yellow";
  return "gray";
}

export const WAITING_COLOR: Record<WaitingLevel, string> = {
  gray: "var(--text3)", yellow: "var(--yellow)", red: "var(--red)",
};

/** How long ago `fromIso` (UTC, with or without a zone suffix) was, e.g. «4 мин», «1 ч 10 мин», «2 дн». */
export function formatWaiting(fromIso: string, now: Date): string {
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(fromIso);
  const from = new Date(hasZone ? fromIso : `${fromIso}Z`).getTime();
  const min = Math.max(0, Math.floor((now.getTime() - from) / 60_000));
  if (min >= 48 * 60) return `${Math.floor(min / 1440)} дн`;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  return `${min} мин`;
}

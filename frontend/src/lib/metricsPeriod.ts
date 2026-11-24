/** Period presets of «Показатели». All days are Bishkek calendar days, `YYYY-MM-DD`. */

export type MetricsPreset = "today" | "week" | "month" | "custom";

export const METRICS_PRESETS: { key: MetricsPreset; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "custom", label: "Свой" },
];

function shift(day: string, days: number): string {
  const [Y, M, D] = day.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D + days)).toISOString().slice(0, 10);
}

/**
 * Range for a preset ending today: «Неделя» = с понедельника текущей недели,
 * «Месяц» = с 1-го числа текущего месяца. `custom` returns null — the caller keeps its dates.
 */
export function presetRange(preset: MetricsPreset, today: string): { from: string; to: string } | null {
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    const [Y, M, D] = today.split("-").map(Number);
    const weekday = (new Date(Date.UTC(Y, M - 1, D)).getUTCDay() + 6) % 7; // Monday = 0
    return { from: shift(today, -weekday), to: today };
  }
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return null;
}

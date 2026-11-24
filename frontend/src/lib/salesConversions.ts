import type { SalesMetricsTotals } from "./types";

/** Percent with one decimal, like the old /analytics strip; null when there is nothing to divide by. */
function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/**
 * Step conversions of «Показатели», same plain ratios as the old /analytics strip:
 * лид→встреча = проведённые встречи / лиды, встреча→продажа = продажи / проведённые встречи.
 */
export function conversions(t: Pick<SalesMetricsTotals, "leads" | "meetings_held" | "sales">): {
  leadToMeeting: number | null;
  meetingToSale: number | null;
} {
  return { leadToMeeting: pct(t.meetings_held, t.leads), meetingToSale: pct(t.sales, t.meetings_held) };
}

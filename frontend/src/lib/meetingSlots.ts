import type { Meeting } from "@/lib/types";
import { DEFAULT_MEETING_MINUTES } from "@/lib/types";
import { bishkekDateTimeParts } from "@/lib/format";

/** Closer working day in Bishkek time: 10:00–19:00, hourly slots. */
export const SLOT_DAY_START = 10;
export const SLOT_DAY_END = 19;
export const SLOT_STEP_MIN = 60;

/** These statuses mean the closer's time is free again. */
const NON_OCCUPYING = new Set(["rescheduled", "not_held"]);

export type MeetingLike = Pick<Meeting, "meeting_date" | "duration_minutes" | "client_name" | "status">;

export interface DaySlot {
  time: string; // HH:mm
  busyBy: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Slots of one Bishkek day (`YYYY-MM-DD`). A meeting occupies every slot its
 * [start, start + duration) interval overlaps.
 */
export function daySlots(meetings: MeetingLike[], day: string): DaySlot[] {
  const busy = meetings
    .filter((m) => !NON_OCCUPYING.has(m.status))
    .map((m) => {
      const p = bishkekDateTimeParts(m.meeting_date);
      const start = Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3, 5));
      const dur = m.duration_minutes > 0 ? m.duration_minutes : DEFAULT_MEETING_MINUTES;
      return { date: p.date, start, end: start + dur, name: m.client_name };
    })
    .filter((m) => m.date === day);

  const slots: DaySlot[] = [];
  for (let t = SLOT_DAY_START * 60; t < SLOT_DAY_END * 60; t += SLOT_STEP_MIN) {
    const hit = busy.find((m) => m.start < t + SLOT_STEP_MIN && m.end > t);
    slots.push({ time: `${pad(Math.floor(t / 60))}:${pad(t % 60)}`, busyBy: hit ? hit.name : null });
  }
  return slots;
}

/** Shift a `YYYY-MM-DD` date by whole days. */
export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * `meetingApi.list` filter for a closer's slots on one Bishkek day. Sub-meetings
 * are included (a reschedule child holds the real new time), and the neighbouring
 * UTC dates are fetched because a Bishkek day spans two of them; `daySlots`
 * then keeps only the requested day.
 */
export function closerDayQuery(closerId: number, day: string) {
  return {
    closer_id: closerId, date_from: shiftDay(day, -1), date_to: shiftDay(day, 1),
    limit: 500, parent_only: false as const,
  };
}

const BISHKEK_OFFSET_MS = 6 * 3600 * 1000;

/** UTC instants (ISO, `Z`) covering Bishkek days `from`..`to` inclusive. */
export function bishkekDayBoundsUtc(from: string, to: string): { date_from: string; date_to: string } {
  const start = Date.parse(`${from}T00:00:00Z`) - BISHKEK_OFFSET_MS;
  const end = Date.parse(`${shiftDay(to, 1)}T00:00:00Z`) - BISHKEK_OFFSET_MS - 1;
  return { date_from: new Date(start).toISOString(), date_to: new Date(end).toISOString() };
}

/**
 * Bishkek-calendar period around `now`: today, this Monday..Sunday, or the whole
 * calendar month. `from`/`to` are Bishkek dates; `date_from`/`date_to` are the
 * UTC instants to send to the API.
 */
export function meetingsPeriodRange(
  period: "day" | "week" | "month", now: Date = new Date(),
): { from: string; to: string; date_from: string; date_to: string } {
  const today = new Date(now.getTime() + BISHKEK_OFFSET_MS).toISOString().slice(0, 10);
  let from = today;
  let to = today;
  if (period === "week") {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    from = shiftDay(today, -dow);
    to = shiftDay(from, 6);
  } else if (period === "month") {
    const [y, mo] = today.split("-").map(Number);
    from = `${today.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    to = `${today.slice(0, 7)}-${pad(last)}`;
  }
  return { from, to, ...bishkekDayBoundsUtc(from, to) };
}

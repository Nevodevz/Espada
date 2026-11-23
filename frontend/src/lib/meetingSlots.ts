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

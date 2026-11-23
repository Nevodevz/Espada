"use client";

import { useEffect, useMemo, useState } from "react";
import { meetingApi } from "@/lib/api";
import { daySlots } from "@/lib/meetingSlots";
import type { Meeting } from "@/lib/types";

interface CloserSlotsProps {
  closerId: number;
  /** YYYY-MM-DD, Bishkek. */
  day: string;
  /** Currently chosen time, HH:mm. */
  value: string;
  onPick: (time: string) => void;
  /** A meeting that must not block its own slot (the one being rescheduled). */
  excludeMeetingId?: number | null;
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function CloserSlots({ closerId, day, value, onPick, excludeMeetingId }: CloserSlotsProps) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMeetings(null);
    setFailed(false);
    // The API compares date_from/date_to against UTC instants, and a Bishkek day
    // spans two UTC dates — fetch the neighbours too; daySlots filters by Bishkek day.
    meetingApi
      .list({ closer_id: closerId, date_from: shiftDay(day, -1), date_to: shiftDay(day, 1), limit: 500 })
      .then((r) => { if (!cancelled) setMeetings(r); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [closerId, day]);

  const slots = useMemo(
    () => daySlots((meetings ?? []).filter((m) => m.id !== excludeMeetingId), day),
    [meetings, day, excludeMeetingId],
  );

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>
        Свободные окна клоузера
        {meetings === null && !failed && " — загрузка…"}
        {failed && " — не удалось загрузить"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {slots.map((s) => {
          const busy = s.busyBy !== null;
          const active = !busy && s.time === value;
          return (
            <button
              key={s.time}
              type="button"
              disabled={busy}
              title={busy ? `Занято: ${s.busyBy}` : "Выбрать время"}
              onClick={() => onPick(s.time)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 6,
                fontFamily: "inherit",
                cursor: busy ? "not-allowed" : "pointer",
                border: `0.5px solid ${active ? "var(--green)" : "var(--border)"}`,
                background: active ? "var(--green-bg)" : busy ? "var(--bg3)" : "transparent",
                color: active ? "var(--green)" : busy ? "var(--text3)" : "var(--text)",
              }}
            >
              {s.time}
              {busy && <span style={{ marginLeft: 4 }}>· {s.busyBy}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

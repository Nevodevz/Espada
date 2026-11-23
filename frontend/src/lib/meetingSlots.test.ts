import { describe, it, expect } from "vitest";
import { daySlots } from "./meetingSlots";

const DAY = "2026-11-23";
// Bishkek 12:00 == 06:00 UTC
const m = (utc: string, dur: number, status = "scheduled", name = "Айбек", id?: number) =>
  ({ id, meeting_date: utc, duration_minutes: dur, client_name: name, status }) as never;

describe("daySlots", () => {
  it("empty day gives 9 free slots 10:00..18:00", () => {
    const s = daySlots([], DAY);
    expect(s).toHaveLength(9);
    expect(s[0]).toEqual({ time: "10:00", busyBy: null });
    expect(s[8].time).toBe("18:00");
    expect(s.every((x) => x.busyBy === null)).toBe(true);
  });
  it("90 min meeting at 12:00 occupies 12:00 and 13:00", () => {
    const s = daySlots([m("2026-11-23T06:00:00", 90)], DAY);
    const busy = s.filter((x) => x.busyBy).map((x) => x.time);
    expect(busy).toEqual(["12:00", "13:00"]);
    expect(s.find((x) => x.time === "12:00")!.busyBy).toBe("Айбек");
  });
  it("rescheduled / not_held do not occupy", () => {
    const s = daySlots([m("2026-11-23T06:00:00", 60, "rescheduled"), m("2026-11-23T07:00:00", 60, "not_held")], DAY);
    expect(s.every((x) => x.busyBy === null)).toBe(true);
  });
  it("meeting on another day does not affect", () => {
    const s = daySlots([m("2026-11-24T06:00:00", 60)], DAY);
    expect(s.every((x) => x.busyBy === null)).toBe(true);
  });
  it("uses Bishkek day: 2026-11-22T20:00Z is 23 Nov 02:00, outside window", () => {
    const s = daySlots([m("2026-11-22T20:00:00", 60)], DAY);
    expect(s.every((x) => x.busyBy === null)).toBe(true);
  });
  it("half-hour offset overlaps both slots", () => {
    const s = daySlots([m("2026-11-23T06:30:00", 60)], DAY);
    expect(s.filter((x) => x.busyBy).map((x) => x.time)).toEqual(["12:00", "13:00"]);
  });
});

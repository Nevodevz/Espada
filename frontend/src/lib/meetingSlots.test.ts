import { describe, it, expect } from "vitest";
import { bishkekDayBoundsUtc, closerDayQuery, daySlots, meetingsPeriodRange } from "./meetingSlots";

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

describe("daySlots with sub-meetings", () => {
  it("a child meeting (reschedule) occupies its slot", () => {
    const child = { ...(m("2026-11-23T08:00:00", 60, "scheduled", "Перенос") as object), parent_id: 7 } as never;
    const parent = m("2026-11-20T06:00:00", 60, "rescheduled", "Исходная");
    const s = daySlots([parent, child], DAY);
    expect(s.find((x) => x.time === "14:00")!.busyBy).toBe("Перенос");
  });
});

describe("closerDayQuery", () => {
  it("includes sub-meetings and the neighbouring UTC days", () => {
    expect(closerDayQuery(5, "2026-11-23")).toEqual({
      closer_id: 5, date_from: "2026-11-22", date_to: "2026-11-24", limit: 500, parent_only: false,
    });
  });
});

describe("meetingsPeriodRange", () => {
  // 2026-11-23 20:00 Bishkek == 14:00 UTC (a Monday)
  const now = new Date("2026-11-23T14:00:00Z");
  it("day covers the whole Bishkek day in UTC", () => {
    expect(meetingsPeriodRange("day", now)).toEqual({
      from: "2026-11-23", to: "2026-11-23",
      date_from: "2026-11-22T18:00:00.000Z", date_to: "2026-11-23T17:59:59.999Z",
    });
  });
  it("uses the Bishkek date, not the browser/UTC one", () => {
    // 2026-11-23 23:30 UTC is already 24th in Bishkek
    expect(meetingsPeriodRange("day", new Date("2026-11-23T23:30:00Z")).from).toBe("2026-11-24");
  });
  it("week is Monday..Sunday", () => {
    const r = meetingsPeriodRange("week", now);
    expect([r.from, r.to]).toEqual(["2026-11-23", "2026-11-29"]);
  });
  it("month is the whole calendar month, including upcoming days", () => {
    const r = meetingsPeriodRange("month", now);
    expect([r.from, r.to]).toEqual(["2026-11-01", "2026-11-30"]);
    expect(r.date_to).toBe("2026-11-30T17:59:59.999Z");
  });
  it("custom bounds convert too", () => {
    expect(bishkekDayBoundsUtc("2026-12-01", "2026-12-02")).toEqual({
      date_from: "2026-11-30T18:00:00.000Z", date_to: "2026-12-02T17:59:59.999Z",
    });
  });
});

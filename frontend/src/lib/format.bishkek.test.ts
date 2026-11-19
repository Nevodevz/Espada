import { describe, expect, it } from "vitest";
import { bishkekDateTimeParts } from "./format";

describe("bishkekDateTimeParts", () => {
  it("shows a UTC instant as Bishkek wall-clock date and time", () => {
    expect(bishkekDateTimeParts("2026-12-01T06:00:00Z")).toEqual({ date: "2026-12-01", time: "12:00" });
  });
  it("rolls over to the next day", () => {
    expect(bishkekDateTimeParts("2026-12-01T20:30:00+00:00")).toEqual({ date: "2026-12-02", time: "02:30" });
  });
  it("treats a naive timestamp as UTC", () => {
    expect(bishkekDateTimeParts("2026-12-01T06:00:00")).toEqual({ date: "2026-12-01", time: "12:00" });
  });
});

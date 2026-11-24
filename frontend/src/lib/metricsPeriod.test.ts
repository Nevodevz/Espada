import { describe, expect, it } from "vitest";
import { presetRange } from "./metricsPeriod";

describe("presetRange", () => {
  it("today is a single day", () => expect(presetRange("today", "2026-11-23")).toEqual({ from: "2026-11-23", to: "2026-11-23" }));
  it("week starts on Monday", () => {
    // 2026-11-23 is a Monday, 2026-11-29 a Sunday.
    expect(presetRange("week", "2026-11-23")).toEqual({ from: "2026-11-23", to: "2026-11-23" });
    expect(presetRange("week", "2026-11-29")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
  });
  it("week crosses a month boundary", () => expect(presetRange("week", "2026-12-02")).toEqual({ from: "2026-11-30", to: "2026-12-02" }));
  it("month starts on the 1st", () => expect(presetRange("month", "2026-11-23")).toEqual({ from: "2026-11-01", to: "2026-11-23" }));
  it("custom keeps the caller's dates", () => expect(presetRange("custom", "2026-11-23")).toBeNull());
});

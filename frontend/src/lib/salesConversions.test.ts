import { describe, expect, it } from "vitest";
import { conversions } from "./salesConversions";

describe("conversions", () => {
  it("plain ratios rounded to one decimal", () =>
    expect(conversions({ leads: 30, meetings_held: 10, sales: 3 })).toEqual({ leadToMeeting: 33.3, meetingToSale: 30 }));
  it("rounds half up at the first decimal", () =>
    expect(conversions({ leads: 8, meetings_held: 1, sales: 0 })).toEqual({ leadToMeeting: 12.5, meetingToSale: 0 }));
  it("null when there are no leads", () =>
    expect(conversions({ leads: 0, meetings_held: 2, sales: 1 })).toEqual({ leadToMeeting: null, meetingToSale: 50 }));
  it("null when no meeting was held", () =>
    expect(conversions({ leads: 5, meetings_held: 0, sales: 1 })).toEqual({ leadToMeeting: 0, meetingToSale: null }));
  it("can exceed 100% — cohorts differ", () =>
    expect(conversions({ leads: 2, meetings_held: 3, sales: 0 }).leadToMeeting).toBe(150));
});

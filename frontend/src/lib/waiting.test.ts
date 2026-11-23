import { describe, expect, it } from "vitest";
import { formatWaiting } from "./waiting";

const now = new Date("2026-11-23T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

describe("formatWaiting", () => {
  it("minutes", () => expect(formatWaiting(ago(4), now)).toBe("4 мин"));
  it("hours and minutes", () => expect(formatWaiting(ago(70), now)).toBe("1 ч 10 мин"));
  it("whole hours", () => expect(formatWaiting(ago(120), now)).toBe("2 ч"));
  it("days", () => expect(formatWaiting(ago(49 * 60), now)).toBe("2 дн"));
  it("future", () => expect(formatWaiting(ago(-5), now)).toBe("0 мин"));
});

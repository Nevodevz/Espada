import { describe, expect, it } from "vitest";
import { boardQueryString } from "./api";

describe("boardQueryString", () => {
  it("adds the board toggles after the list filters", () => {
    expect(boardQueryString({ stage_id: 3, mine: true, show_closed: true })).toBe("?stage_id=3&mine=true&show_closed=true");
  });
  it("works with toggles only and never relies on URLSearchParams.size", () => {
    const original = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
    Object.defineProperty(URLSearchParams.prototype, "size", { get: () => undefined, configurable: true });
    try {
      expect(boardQueryString({ unassigned: true })).toBe("?unassigned=true");
      expect(boardQueryString({})).toBe("");
    } finally {
      if (original) Object.defineProperty(URLSearchParams.prototype, "size", original);
    }
  });
});

describe("listQueryString", () => {
  it("sends show_closed=false explicitly for the list", async () => {
    const { listQueryString } = await import("./api");
    expect(listQueryString({ show_closed: false, overdue: true })).toBe("?overdue=true&show_closed=false");
    expect(listQueryString({ show_closed: true })).toBe("?show_closed=true");
  });
});

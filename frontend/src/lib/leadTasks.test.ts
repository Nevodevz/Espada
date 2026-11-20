import { describe, expect, it } from "vitest";
import { groupMyTasks, isOverdue, quickDue } from "./leadTasks";
import type { LeadTask } from "./types";

// Bishkek is UTC+6: 12:00 local = 06:00Z.
const bk = (iso: string) => new Date(`${iso}+06:00`);

describe("quickDue", () => {
  it("evening = 18:00 Bishkek today, hidden after 18:00", () => {
    expect(quickDue("evening", bk("2026-11-20T12:00:00"))?.toISOString()).toBe("2026-11-20T12:00:00.000Z");
    expect(quickDue("evening", bk("2026-11-20T19:00:00"))).toBeNull();
    expect(quickDue("evening", bk("2026-11-20T18:00:00"))).toBeNull();
  });
  it("tomorrow = 10:00 Bishkek next day, also late at night", () => {
    expect(quickDue("tomorrow", bk("2026-11-20T23:30:00"))?.toISOString()).toBe("2026-11-21T04:00:00.000Z");
    expect(quickDue("tomorrow", bk("2026-11-21T00:30:00"))?.toISOString()).toBe("2026-11-22T04:00:00.000Z");
  });
  it("relative choices", () => {
    const now = new Date("2026-11-20T06:00:00Z");
    expect(quickDue("15m", now)?.toISOString()).toBe("2026-11-20T06:15:00.000Z");
    expect(quickDue("1h", now)?.toISOString()).toBe("2026-11-20T07:00:00.000Z");
    expect(quickDue("callback", now)?.toISOString()).toBe("2026-11-20T08:00:00.000Z");
  });
});

const t = (id: number, due: string) => ({ id, due_at: due, status: "open" }) as LeadTask;

describe("groupMyTasks", () => {
  it("splits by Bishkek midnight", () => {
    const now = bk("2026-11-20T15:00:00");
    const groups = groupMyTasks(
      [t(1, bk("2026-11-20T14:00:00").toISOString()), t(2, bk("2026-11-20T23:50:00").toISOString()),
       t(3, bk("2026-11-21T00:10:00").toISOString())],
      now,
    );
    expect(groups.overdue.map((x) => x.id)).toEqual([1]);
    expect(groups.today.map((x) => x.id)).toEqual([2]);
    expect(groups.later.map((x) => x.id)).toEqual([3]);
  });
});

describe("isOverdue", () => {
  it("open task past its due time", () => {
    const now = new Date("2026-11-20T06:00:00Z");
    expect(isOverdue(t(1, "2026-11-20T05:59:00Z"), now)).toBe(true);
    expect(isOverdue(t(1, "2026-11-20T06:01:00Z"), now)).toBe(false);
    expect(isOverdue({ ...t(1, "2026-11-20T05:00:00Z"), status: "done" }, now)).toBe(false);
  });
});

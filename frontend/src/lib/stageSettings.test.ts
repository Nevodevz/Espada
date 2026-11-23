import { describe, expect, it } from "vitest";
import { archiveTarget, archiveWarning, isServiceStage, reorderPosition } from "./stageSettings";
import type { LeadStage } from "./types";

function st(id: number, over: Partial<LeadStage> = {}): LeadStage {
  return {
    id, name: `S${id}`, position: id, norm_days: null, is_won: false, is_lost: false,
    color: "#4648d4", is_archived: false, kind: "generic", ...over,
  };
}

describe("isServiceStage", () => {
  it("generic is not service", () => expect(isServiceStage({ kind: "generic" })).toBe(false));
  it("meeting is service", () => expect(isServiceStage({ kind: "meeting" })).toBe(true));
  it("won is service", () => expect(isServiceStage({ kind: "won" })).toBe(true));
});

describe("archiveTarget", () => {
  it("skips the removed stage and won/lost", () => {
    const list = [st(1), st(2), st(3, { is_won: true, kind: "won" })];
    expect(archiveTarget(list, 1)?.id).toBe(2);
    expect(archiveTarget(list, 2)?.id).toBe(1);
  });
  it("skips archived and lost", () => {
    const list = [st(1), st(2, { is_archived: true }), st(3, { is_lost: true, kind: "lost" }), st(4)];
    expect(archiveTarget(list, 1)?.id).toBe(4);
  });
  it("null when nowhere to go", () => {
    expect(archiveTarget([st(1), st(2, { is_won: true })], 1)).toBeNull();
  });
});

describe("archiveWarning", () => {
  it("moves leads", () =>
    expect(archiveWarning(st(1, { name: "A", lead_count: 3 }), st(2, { name: "B" })))
      .toBe("На этапе «A» 3 лидов — они переедут на этап «B»."));
  it("empty stage", () =>
    expect(archiveWarning(st(1, { name: "A", lead_count: 0 }), st(2))).toBe("Этап «A» будет удалён."));
  it("no target", () =>
    expect(archiveWarning(st(1, { lead_count: 2 }), null)).toBe("Удалить нельзя: некуда перенести лиды."));
});

describe("reorderPosition", () => {
  const list = [st(1), st(2), st(3), st(4, { is_won: true, kind: "won" }), st(5, { is_lost: true, kind: "lost" })];
  it("uses the target position", () => expect(reorderPosition(list, 1, 3)).toBe(3));
  it("clamps drops on won/lost to the last movable stage", () => expect(reorderPosition(list, 1, 5)).toBe(3));
  it("pinned stages never move", () => expect(reorderPosition(list, 4, 1)).toBeNull());
  it("no-op on itself", () => expect(reorderPosition(list, 2, 2)).toBeNull());
});

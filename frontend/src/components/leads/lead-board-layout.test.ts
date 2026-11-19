import { describe, expect, it } from "vitest";
import { applyOptimisticMove, cardsForStage, dropAction, keepFormOnError, shouldPoll, splitStages } from "./lead-board-layout";
import type { LeadBoardCard, LeadStage, StageKind } from "@/lib/types";

const stage = (id: number, position: number, kind: StageKind = "generic") =>
  ({ id, name: `S${id}`, position, kind, color: "#000", is_won: kind === "won", is_lost: kind === "lost", norm_days: null, is_archived: false }) as LeadStage;
const card = (id: number, stage_id: number | null) => ({ id, stage_id }) as LeadBoardCard;

describe("splitStages", () => {
  it("puts won/lost into drop zones and sorts both by position", () => {
    const { columns, dropZones } = splitStages([stage(3, 2, "meeting"), stage(9, 9, "lost"), stage(1, 0), stage(8, 8, "won")]);
    expect(columns.map((s) => s.id)).toEqual([1, 3]);
    expect(dropZones.map((s) => s.id)).toEqual([8, 9]);
  });
});

describe("dropAction", () => {
  it("does nothing on the same stage", () => expect(dropAction(1, stage(1, 0))).toBe("none"));
  it("moves straight onto a generic stage", () => expect(dropAction(1, stage(2, 1))).toBe("move"));
  it("asks for details on any other stage", () => {
    expect(dropAction(1, stage(3, 2, "meeting"))).toBe("transition");
    expect(dropAction(null, stage(9, 9, "lost"))).toBe("transition");
  });
});

describe("cardsForStage", () => {
  it("keeps server order", () => {
    const cards = [card(5, 1), card(2, 2), card(7, 1)];
    expect(cardsForStage(cards, 1).map((c) => c.id)).toEqual([5, 7]);
  });
});

describe("applyOptimisticMove", () => {
  it("changes only the moved card and does not mutate the input", () => {
    const cards = [card(1, 1), card(2, 1)];
    const next = applyOptimisticMove(cards, 2, 4);
    expect(next.map((c) => c.stage_id)).toEqual([1, 4]);
    expect(cards[1].stage_id).toBe(1);
  });
});

describe("shouldPoll", () => {
  it("polls only when visible, idle and without an open dialog", () => {
    expect(shouldPoll({ visible: true, modalOpen: false, mutating: false })).toBe(true);
    expect(shouldPoll({ visible: false, modalOpen: false, mutating: false })).toBe(false);
    expect(shouldPoll({ visible: true, modalOpen: true, mutating: false })).toBe(false);
    expect(shouldPoll({ visible: true, modalOpen: false, mutating: true })).toBe(false);
  });
});

describe("keepFormOnError", () => {
  it("closes the payment form (payment already recorded) and keeps the others open", () => {
    expect(keepFormOnError("won")).toBe(false);
    expect(keepFormOnError("meeting")).toBe(true);
    expect(keepFormOnError("lost")).toBe(true);
  });
});

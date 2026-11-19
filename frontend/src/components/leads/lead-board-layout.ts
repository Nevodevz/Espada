import type { LeadBoardCard, LeadStage } from "@/lib/types";

const CLOSED = new Set(["won", "lost"]);
const byPosition = (a: LeadStage, b: LeadStage) => a.position - b.position || a.id - b.id;

/** Board columns are open stages; won/lost become drop zones under the board. */
export function splitStages(stages: LeadStage[]): { columns: LeadStage[]; dropZones: LeadStage[] } {
  const sorted = [...stages].sort(byPosition);
  return {
    columns: sorted.filter((s) => !CLOSED.has(s.kind)),
    dropZones: sorted.filter((s) => CLOSED.has(s.kind)),
  };
}

/** Cards of one stage, in the order the server sorted them. */
export function cardsForStage(cards: LeadBoardCard[], stageId: number): LeadBoardCard[] {
  return cards.filter((card) => card.stage_id === stageId);
}

/** Generic stages move at once; every other kind needs the transition form. */
export function dropAction(fromStageId: number | null, to: LeadStage): "none" | "move" | "transition" {
  if (fromStageId === to.id) return "none";
  return to.kind === "generic" ? "move" : "transition";
}

export function applyOptimisticMove(cards: LeadBoardCard[], leadId: number, toStageId: number): LeadBoardCard[] {
  return cards.map((card) => (card.id === leadId ? { ...card, stage_id: toStageId } : card));
}

/** Background refresh must never redraw the board under an open dialog or a running change. */
export function shouldPoll(state: { visible: boolean; modalOpen: boolean; mutating: boolean }): boolean {
  return state.visible && !state.modalOpen && !state.mutating;
}

/**
 * After a failed stage change: a payment attempt may already be recorded (partial
 * payment), so its form closes to avoid submitting it twice; other forms stay open.
 */
export function keepFormOnError(kind: LeadStage["kind"]): boolean {
  return kind !== "won";
}

/** Leads without a stage, or on an archived stage — shown in a «Без этапа» column so none vanish. */
export function cardsWithoutColumn(cards: LeadBoardCard[], stages: LeadStage[]): LeadBoardCard[] {
  const ids = new Set(stages.map((s) => s.id));
  return cards.filter((card) => card.stage_id == null || !ids.has(card.stage_id));
}

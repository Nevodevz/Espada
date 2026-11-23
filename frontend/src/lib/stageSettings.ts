import type { LeadStage } from "./types";

/** Service stage = has built-in behaviour: can be renamed/recoloured, never deleted. */
export function isServiceStage(s: Pick<LeadStage, "kind">): boolean {
  return s.kind !== "generic";
}

/** Won/lost stages are pinned to the end of the board. */
export function isPinnedStage(s: Pick<LeadStage, "is_won" | "is_lost">): boolean {
  return s.is_won || s.is_lost;
}

/** Where leads of a removed stage go: first active non-won/lost stage (mirrors the backend). */
export function archiveTarget(stages: LeadStage[], id: number): LeadStage | null {
  return stages.find((s) => s.id !== id && !s.is_archived && !s.is_won && !s.is_lost) ?? null;
}

export function archiveWarning(stage: LeadStage, target: LeadStage | null): string {
  if (!target) return "Удалить нельзя: некуда перенести лиды.";
  if (!stage.lead_count) return `Этап «${stage.name}» будет удалён.`;
  return `На этапе «${stage.name}» ${stage.lead_count} лидов — они переедут на этап «${target.name}».`;
}

/**
 * `new_position` for `POST /stages/{id}/reorder` when `activeId` is dropped on `overId`,
 * or null when nothing changes. Drops onto won/lost rows are clamped to the last movable
 * row; pinned stages never move. Uses the server `position` of the target stage.
 */
export function reorderPosition(stages: LeadStage[], activeId: number, overId: number): number | null {
  const active = stages.find((s) => s.id === activeId);
  let over = stages.find((s) => s.id === overId);
  if (!active || !over || isPinnedStage(active)) return null;
  if (isPinnedStage(over)) {
    const movable = stages.filter((s) => !isPinnedStage(s));
    over = movable[movable.length - 1];
  }
  if (!over || over.id === active.id) return null;
  return over.position;
}

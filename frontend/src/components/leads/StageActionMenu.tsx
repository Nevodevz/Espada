"use client";

import { STAGE_ACTION_LABELS, stageKind } from "@/components/TransitionModal";
import type { LeadStage } from "@/lib/types";

function actionLabel(stage: LeadStage): string {
  const kind = stageKind(stage);
  return kind === "generic" ? `→ ${stage.name}` : `${STAGE_ACTION_LABELS[kind]} (${stage.name})`;
}

/**
 * Keyboard- and touch-friendly way to move a card: a native select of the other
 * stages. Picking one goes through the same path as dropping the card there.
 */
export function StageActionMenu({ currentStageId, stages, disabled, label, onSelect }: {
  currentStageId: number | null;
  stages: LeadStage[];
  disabled?: boolean;
  label: string;
  onSelect: (stage: LeadStage) => void;
}) {
  const options = stages.filter((s) => s.id !== currentStageId);
  return (
    <select
      className="lead-board-action"
      aria-label={label}
      disabled={disabled}
      value=""
      onChange={(event) => {
        const stage = options.find((s) => s.id === Number(event.target.value));
        if (stage) onSelect(stage);
      }}
    >
      <option value="" disabled>Действие…</option>
      {options.map((s) => <option key={s.id} value={s.id}>{actionLabel(s)}</option>)}
    </select>
  );
}

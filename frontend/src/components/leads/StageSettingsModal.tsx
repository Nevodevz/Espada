"use client";

import { useCallback, useEffect, useState } from "react";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Modal } from "@/components/Modal";
import { Button, Input } from "@/components/ui";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/context/ToastContext";
import { settingsApi } from "@/lib/api";
import { archiveTarget, archiveWarning, blurActiveField, isPinnedStage, isServiceStage, reorderPosition } from "@/lib/stageSettings";
import { STAGE_KIND_LABELS, type LeadStage } from "@/lib/types";

const PALETTE = ["#4648d4", "#0ea5e9", "#10b981", "#84cc16", "#f59e0b", "#f97316", "#ef4444", "#a855f7"];

function StageRow({ stage, busy, resetToken, onRename, onColor, onDelete }: {
  stage: LeadStage;
  busy: boolean;
  /** Bumped after a failed save so the field drops rejected text. */
  resetToken: number;
  onRename: (name: string) => void;
  onColor: (color: string) => void;
  onDelete: () => void;
}) {
  const pinned = isPinnedStage(stage);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id, disabled: pinned });
  const [name, setName] = useState(stage.name);
  useEffect(() => setName(stage.name), [stage.name, resetToken]);

  function commit() {
    const next = name.trim();
    if (!next) { setName(stage.name); return; }
    if (next !== stage.name) onRename(next);
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.6 : 1,
        display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
        borderBottom: "0.5px solid var(--border)", background: "var(--bg)",
      }}
    >
      <button
        type="button"
        aria-label="Перетащить этап"
        {...(pinned ? {} : { ...attributes, ...listeners })}
        disabled={pinned}
        style={{ border: 0, background: "transparent", cursor: pinned ? "default" : "grab", opacity: pinned ? 0.3 : 1, touchAction: "none" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>drag_indicator</span>
      </button>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Input
          value={name}
          aria-label={`Название этапа «${stage.name}»`}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      {isServiceStage(stage) && (
        <span className="sett-badge" style={{ background: "var(--bg3)", color: "var(--text2)" }}>{STAGE_KIND_LABELS[stage.kind]}</span>
      )}
      <div style={{ display: "flex", gap: 4 }} role="group" aria-label="Цвет">
        {PALETTE.map((c) => (
          <button
            key={c} type="button" aria-label={`Цвет ${c}`} aria-pressed={stage.color.toLowerCase() === c}
            onClick={() => stage.color.toLowerCase() !== c && onColor(c)}
            style={{
              width: 18, height: 18, borderRadius: "50%", background: c, cursor: "pointer", padding: 0,
              border: stage.color.toLowerCase() === c ? "2px solid var(--text)" : "1px solid var(--border)",
            }}
          />
        ))}
      </div>
      {!isServiceStage(stage) ? (
        <button className="sett-icon-btn" title="Удалить" aria-label="Удалить" disabled={busy} onClick={onDelete}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
        </button>
      ) : <span style={{ width: 28 }} />}
    </div>
  );
}

export function StageSettingsModal({ open, onClose, onChanged }: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [resetToken, setResetToken] = useState(0);
  const [deleting, setDeleting] = useState<LeadStage | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reload = useCallback(async () => {
    setStages(await settingsApi.listStages(false, true));
  }, []);

  useEffect(() => {
    if (!open) return;
    reload().catch((e) => toast(e.message || "Не удалось загрузить этапы", "error"));
  }, [open, reload, toast]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      onChanged();
      if (ok) toast(ok, "success");
    } catch (e: any) {
      toast(e.message || "Ошибка", "error");
      setResetToken((n) => n + 1);
    } finally {
      try { await reload(); } catch { /* keep the list we have */ }
      setBusy(false);
    }
  }

  function close() {
    // Commit a half-typed rename first (blur → commit → run), otherwise Escape / «Готово» drop it.
    blurActiveField(document);
    onClose();
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return;
    const position = reorderPosition(stages, Number(e.active.id), Number(e.over.id));
    if (position === null) return;
    run(() => settingsApi.reorderStage(Number(e.active.id), position));
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    run(() => settingsApi.createStage({ name }).then(() => setNewName("")));
  }

  const target = deleting ? archiveTarget(stages, deleting.id) : null;

  return (
    <>
      <Modal open={open && !deleting} onClose={close} title="Настроить этапы" width={720}
        footer={<Button variant="primary" onClick={close}>Готово</Button>}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {stages.map((s) => (
              <StageRow
                key={s.id} stage={s} busy={busy}
                resetToken={resetToken}
                onRename={(name) => run(() => settingsApi.updateStage(s.id, { name }))}
                onColor={(color) => run(() => settingsApi.updateStage(s.id, { color }))}
                onDelete={() => setDeleting(s)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <div style={{ flex: 1 }}>
            <Input
              placeholder="Название нового этапа"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newName.trim() && !busy) add(); }}
            />
          </div>
          <Button variant="ghost" icon="add" disabled={busy || !newName.trim()} onClick={add}>Добавить этап</Button>
        </div>
      </Modal>
      <ConfirmModal
        open={!!deleting}
        title="Удалить этап"
        message={deleting ? archiveWarning(deleting, target) : ""}
        confirmLabel={target ? "Удалить" : "Понятно"}
        variant={target ? "danger" : "primary"}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const s = deleting;
          setDeleting(null);
          if (s && target) run(() => settingsApi.archiveStage(s.id), "Этап удалён");
        }}
      />
    </>
  );
}

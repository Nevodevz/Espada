"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  pointerWithin, closestCenter, useDraggable, useDroppable,
  type CollisionDetection, type DragEndEvent,
} from "@dnd-kit/core";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import { Button } from "@/components/ui";
import { StageActionMenu } from "./StageActionMenu";
import { cardsForStage, cardsWithoutColumn, splitStages } from "./lead-board-layout";
import { fmtDateTime, fmtMoneyShort } from "@/lib/format";
import { TASK_KIND_LABELS } from "@/lib/leadTasks";
import type { LeadBoardCard, LeadBoardData, LeadStage } from "@/lib/types";

interface Props {
  data: LeadBoardData;
  disabled: boolean;
  /** Drop or menu pick of a card onto a stage; the page decides move vs. transition form. */
  onDropCard: (card: LeadBoardCard, stage: LeadStage) => void;
  /** «Показать закрытые»: won/lost stages become regular columns with their cards. */
  showClosed?: boolean;
  /** «Взять себе» on a card without a setter (shown only when provided). */
  onTake?: (card: LeadBoardCard) => void;
}

/** Links, buttons and form controls inside a card keep their own click behaviour and never start a drag. */
const INTERACTIVE = "a, button, input, select, textarea, [role='menu'], [role='menuitem']";
function isInteractive(target: EventTarget | null) {
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}
class CardMouseSensor extends MouseSensor {
  static activators = [{
    eventName: "onMouseDown" as const,
    handler: ({ nativeEvent }: ReactMouseEvent) => !isInteractive(nativeEvent.target) && nativeEvent.button === 0,
  }];
}
class CardTouchSensor extends TouchSensor {
  static activators = [{
    eventName: "onTouchStart" as const,
    handler: ({ nativeEvent }: ReactTouchEvent) => !isInteractive(nativeEvent.target) && nativeEvent.touches.length === 1,
  }];
}

const TakeContext = createContext<Props["onTake"]>(undefined);

function TaskBadge({ card }: { card: LeadBoardCard }) {
  const closed = card.stage?.kind === "won" || card.stage?.kind === "lost";
  const streak = card.no_answer_streak ?? 0;
  return (
    <div className="lead-board-meta" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {card.next_task ? (
        <span style={{ color: card.next_task.overdue ? "var(--red)" : "var(--text2)", fontWeight: card.next_task.overdue ? 600 : 400 }}>
          ⏰ {TASK_KIND_LABELS[card.next_task.kind]} · {fmtDateTime(card.next_task.due_at)}
        </span>
      ) : !closed ? (
        <span style={{ color: "var(--yellow)" }}>Нет задачи</span>
      ) : null}
      {streak > 0 && <span style={{ color: "var(--red)" }} title="Недозвонов подряд">📵×{streak}</span>}
    </div>
  );
}

function CardContent({ card }: { card: LeadBoardCard }) {
  return <>
    <div className="lead-board-title-row">
      <Link href={`/leads/${card.id}`} className="lead-board-title">{card.client_name || "Лид без имени"}</Link>
      {card.whatsapp_unread > 0 && (
        <span className="lead-board-unread" title="Непрочитанные сообщения WhatsApp" aria-label={`Непрочитанных WhatsApp: ${card.whatsapp_unread}`}>
          💬 {card.whatsapp_unread}
        </span>
      )}
    </div>
    {card.company_name && <div className="lead-board-company">{card.company_name}</div>}
    {card.service && <div className="lead-board-meta">{card.service.name}</div>}
    {card.deal_amount > 0 && <div className="lead-board-money">{fmtMoneyShort(card.deal_amount)}</div>}
    <TaskBadge card={card} />
    {(card.setter || card.closer) && <div className="lead-board-meta">
      {card.setter && <div>Сеттер: {card.setter.name}</div>}
      {card.closer && <div>Клоузер: {card.closer.name}</div>}
    </div>}
  </>;
}

function LeadCard({ card, stages, disabled, onDropCard }: {
  card: LeadBoardCard; stages: LeadStage[]; disabled: boolean; onDropCard: Props["onDropCard"];
}) {
  const onTake = useContext(TakeContext);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `lead-${card.id}`, disabled, data: { leadId: card.id },
  });
  // Whole card is the drag activator; it is also the keyboard activator, so Enter on the inner link still navigates.
  return <article ref={(node) => { setNodeRef(node); setActivatorNodeRef(node); }} className="lead-board-card" data-lead-id={card.id}
    data-draggable={disabled ? undefined : "true"} style={{ opacity: isDragging ? 0.35 : 1 }}
    aria-label={`Лид «${card.client_name}». Пробел — перетащить`} {...attributes} {...listeners}>
    <div className="lead-board-card-tools">
      <span className="lead-board-handle" aria-hidden="true">
        <span className="material-symbols-outlined">drag_indicator</span>
      </span>
      <StageActionMenu currentStageId={card.stage_id} stages={stages} disabled={disabled}
        label={`Перевести лид «${card.client_name}»`} onSelect={(stage) => onDropCard(card, stage)} />
    </div>
    <CardContent card={card} />
    {onTake && !card.setter_id && (
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onTake(card)} style={{ marginTop: 8 }}>Взять себе</Button>
    )}
  </article>;
}

function StageColumn({ stage, cards, stages, disabled, onDropCard }: {
  stage: LeadStage; cards: LeadBoardCard[]; stages: LeadStage[]; disabled: boolean; onDropCard: Props["onDropCard"];
}) {
  const [limit, setLimit] = useState(30);
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}`, disabled, data: { stageId: stage.id } });
  return <section className="lead-board-column" aria-label={stage.name}>
    <header className="lead-board-column-head">
      <span className="lead-board-dot" style={{ background: stage.color }} />
      <h2>{stage.name}</h2>
      <span className="lead-board-count">{cards.length}</span>
    </header>
    <div ref={setNodeRef} className={`lead-board-lane${isOver ? " lead-board-lane-over" : ""}`} data-stage-id={stage.id}>
      {cards.slice(0, limit).map((card) => <LeadCard key={card.id} card={card} stages={stages} disabled={disabled} onDropCard={onDropCard} />)}
      {!cards.length && <div className="lead-board-empty">Перетащите лид сюда</div>}
      {cards.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit((v) => v + 30)}>Показать ещё {Math.min(30, cards.length - limit)}</Button>}
    </div>
  </section>;
}

/** Leads with no stage or an archived one: visible and movable via the menu, not a drop target. */
function NoStageColumn({ cards, stages, disabled, onDropCard }: {
  cards: LeadBoardCard[]; stages: LeadStage[]; disabled: boolean; onDropCard: Props["onDropCard"];
}) {
  return <section className="lead-board-column" aria-label="Без этапа">
    <header className="lead-board-column-head">
      <span className="lead-board-dot" style={{ background: "#767586" }} />
      <h2>Без этапа / архивный этап</h2>
      <span className="lead-board-count">{cards.length}</span>
    </header>
    <div className="lead-board-lane">
      {cards.map((card) => <LeadCard key={card.id} card={card} stages={stages} disabled={disabled} onDropCard={onDropCard} />)}
    </div>
  </section>;
}

function DropZone({ stage, count, disabled }: { stage: LeadStage; count: number; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}`, disabled, data: { stageId: stage.id } });
  return <div ref={setNodeRef} className={`lead-board-zone${isOver ? " lead-board-zone-over" : ""}`}
    style={{ borderColor: stage.color, color: stage.color }} data-stage-id={stage.id}>
    {stage.name}{count ? ` · ${count}` : ""}
  </div>;
}

export function LeadBoard({ data, disabled, onDropCard, showClosed = false, onTake }: Props) {
  const [activeCard, setActiveCard] = useState<LeadBoardCard | null>(null);
  const sensors = useSensors(
    useSensor(CardMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(CardTouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const split = splitStages(data.stages);
  const allStages = [...split.columns, ...split.dropZones];
  const columns = showClosed ? allStages : split.columns;
  const dropZones = showClosed ? [] : split.dropZones;
  const orphans = cardsWithoutColumn(data.leads, allStages);
  const collisionDetection: CollisionDetection = (args) =>
    args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

  function onDragEnd(event: DragEndEvent) {
    const card = activeCard;
    setActiveCard(null);
    if (disabled || !card || !event.over) return;
    const stage = allStages.find((s) => s.id === event.over?.data.current?.stageId);
    if (stage) onDropCard(card, stage);
  }

  return <TakeContext.Provider value={onTake}>
    <div className="lead-board-toolbar"><span>Лидов на доске: {data.leads.length}</span></div>
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}
      onDragCancel={() => setActiveCard(null)}
      onDragStart={(event) => setActiveCard(data.leads.find((c) => c.id === event.active.data.current?.leadId) ?? null)}>
      <div className="lead-board-scroll" aria-label="Канбан лидов" aria-busy={disabled}>
        <div className="lead-board-columns">
          {orphans.length > 0 && <NoStageColumn cards={orphans} stages={allStages} disabled={disabled} onDropCard={onDropCard} />}
          {columns.map((stage) => <StageColumn key={stage.id} stage={stage} cards={cardsForStage(data.leads, stage.id)}
            stages={allStages} disabled={disabled} onDropCard={onDropCard} />)}
        </div>
      </div>
      {dropZones.length > 0 && <div className="lead-board-zones" aria-label="Закрыть лид">
        {dropZones.map((stage) => <DropZone key={stage.id} stage={stage} count={cardsForStage(data.leads, stage.id).length} disabled={disabled} />)}
      </div>}
      <DragOverlay>{activeCard ? <article className="lead-board-card lead-board-overlay"><CardContent card={activeCard} /></article> : null}</DragOverlay>
    </DndContext>
    <style jsx global>{`
      .lead-board-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; color:var(--text3); font-size:13px; }
      .lead-board-scroll { max-width:100%; overflow-x:auto; padding:4px 2px 16px; }
      .lead-board-columns { display:flex; gap:16px; align-items:flex-start; width:max-content; }
      .lead-board-column { width:290px; flex-shrink:0; background:var(--bg3); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
      .lead-board-column-head { display:flex; align-items:center; gap:8px; padding:12px; min-height:52px; }
      .lead-board-column-head h2 { margin:0; font-size:13px; font-weight:600; color:var(--text); overflow-wrap:anywhere; flex:1; }
      .lead-board-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
      .lead-board-count { border-radius:6px; padding:2px 6px; background:var(--bg2); font-size:12px; color:var(--text3); }
      .lead-board-lane { min-height:220px; padding:8px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:10px; transition:background .15s; }
      .lead-board-lane-over { background:var(--primary-bg,var(--bg2)); outline:2px solid var(--primary); outline-offset:-2px; }
      .lead-board-card { padding:12px; border:1px solid var(--border); border-radius:10px; background:var(--bg2); box-shadow:var(--shadow-sm); color:var(--text); }
      .lead-board-card-tools { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
      .lead-board-action { min-width:0; flex:1; border:1px solid var(--border); border-radius:5px; padding:4px; background:var(--bg2); color:var(--text3); font-size:11px; }
      .lead-board-handle { display:flex; justify-content:center; align-items:center; background:none; border:0; color:var(--text3); padding:2px; border-radius:4px; cursor:grab; }
      .lead-board-card[data-draggable] { cursor:grab; }
      .lead-board-handle .material-symbols-outlined { font-size:18px; }
      .lead-board-card:focus-visible { outline:2px solid var(--primary); }
      .lead-board-title-row { display:flex; align-items:flex-start; gap:8px; }
      .lead-board-title-row .lead-board-title { flex:1; }
      .lead-board-unread { flex-shrink:0; border-radius:10px; padding:1px 7px; background:var(--green); color:#fff; font-size:11px; font-weight:600; }
      .lead-board-title { display:block; color:var(--text); font-size:14px; font-weight:600; text-decoration:none; overflow-wrap:anywhere; }
      .lead-board-title:hover { color:var(--primary); }
      .lead-board-company { margin-top:4px; color:var(--text2); font-size:12px; overflow-wrap:anywhere; }
      .lead-board-meta { margin-top:6px; font-size:11px; color:var(--text3); }
      .lead-board-money { margin-top:8px; font-size:13px; font-weight:600; }
      .lead-board-empty { padding:28px 10px; text-align:center; color:var(--text3); font-size:12px; border:1px dashed var(--border); border-radius:8px; }
      .lead-board-overlay { width:274px; box-shadow:var(--shadow-md); cursor:grabbing; }
      .lead-board-zones { display:flex; gap:16px; margin-top:4px; flex-wrap:wrap; }
      .lead-board-zone { flex:1 1 240px; padding:18px; border:2px dashed; border-radius:12px; text-align:center; font-size:14px; font-weight:600; background:var(--bg2); transition:background .15s; }
      .lead-board-zone-over { background:var(--bg3); }
      @media (max-width:768px) { .lead-board-column { width:275px; } }
    `}</style>
  </TakeContext.Provider>;
}

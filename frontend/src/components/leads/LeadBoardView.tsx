"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { LeadBoard } from "@/components/leads/LeadBoard";
import { applyOptimisticMove, dropAction, keepFormOnError, shouldPoll } from "@/components/leads/lead-board-layout";
import { TransitionModal } from "@/components/TransitionModal";
import { useToast } from "@/context/ToastContext";
import { leadApi, leadBoardApi, settingsApi, whatsappApi, type BoardQuery } from "@/lib/api";
import type { LeadBoardCard, LeadBoardData, LeadStage, RejectReason, UserWithStats } from "@/lib/types";

const POLL_MS = 30_000;

/** Stage board. Filters and toggles live in the page; this view only loads and moves cards. */
export function LeadBoardView({ query, users, refreshKey = 0, onBusyChange }: {
  query: BoardQuery;
  users: UserWithStats[];
  /** Bump to reload the board (after a lead is created, manual refresh). */
  refreshKey?: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<LeadBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const generation = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<RejectReason[]>([]);
  const [pending, setPending] = useState<{ card: LeadBoardCard; stage: LeadStage } | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  useEffect(() => { onBusyChange?.(mutating); }, [mutating, onBusyChange]);
  // Leaving the board (e.g. switching to «Список») mid-move must not leave the page locked.
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const load = useCallback(async (quiet = false) => {
    const request = ++generation.current;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const board = await leadBoardApi.get(query);
      if (request === generation.current) setData(board);
    } catch (failure) {
      if (request === generation.current) setError((failure as Error).message || "Не удалось загрузить доску");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    load();
    return () => { generation.current++; };
  }, [load, refreshKey]);

  // Background refresh — never under an open dialog or during a change. Board only.
  const pollState = useRef({ modalOpen: false, mutating: false });
  pollState.current = { modalOpen: !!pending, mutating };
  useEffect(() => {
    const timer = setInterval(() => {
      if (shouldPoll({ visible: document.visibilityState === "visible", ...pollState.current })) load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    settingsApi.listRejectReasons().then(setRejectReasons)
      .catch(() => toast("Не удалось загрузить причины отказа", "error"));
  }, [toast]);

  async function moveNow(card: LeadBoardCard, stage: LeadStage) {
    const before = data;
    if (before) setData({ ...before, leads: applyOptimisticMove(before.leads, card.id, stage.id) });
    setMutating(true);
    try {
      await leadApi.changeStage(card.id, stage.id);
      toast(`Этап → «${stage.name}»`, "success");
      await load(true);
    } catch (failure) {
      if (before) setData(before);
      toast((failure as Error).message || "Не удалось сменить этап", "error");
    } finally {
      setMutating(false);
    }
  }

  function onDropCard(card: LeadBoardCard, stage: LeadStage) {
    if (mutating) return;
    const action = dropAction(card.stage_id, stage);
    if (action === "move") moveNow(card, stage);
    else if (action === "transition") { setTransitionError(null); setPending({ card, stage }); }
  }

  async function confirmTransition(comment: string, extra: Record<string, unknown>) {
    if (!pending) return;
    const { card, stage } = pending;
    setMutating(true);
    setTransitionError(null);
    try {
      await leadApi.changeStage(card.id, stage.id, comment, extra);
      setPending(null);
      toast(stage.kind === "won" ? "Сделка полностью оплачена и закрыта" : `Этап → «${stage.name}»`, "success");
    } catch (failure) {
      const message = (failure as Error).message || "Не удалось сменить этап";
      if (!keepFormOnError(stage.kind)) {
        // A partial payment is already recorded even though the stage stays; closing the
        // form prevents the same payment being submitted twice.
        setPending(null);
        toast(message, "error");
      } else {
        setTransitionError(message);
      }
    } finally {
      setMutating(false);
      await load(true);
    }
  }

  return <>
    {error && <Card padding="20px" style={{ marginBottom: 16 }}>
      <div role="alert" style={{ color: "var(--red)", marginBottom: 12 }}>{error}</div>
      <Button variant="ghost" disabled={loading} onClick={() => load()}>Повторить</Button>
    </Card>}
    {!data && loading && <div role="status" style={{ padding: 40, color: "var(--text3)" }}>Загрузка доски…</div>}
    {data && <LeadBoard data={data} disabled={loading || mutating} showClosed={!!query.show_closed} onDropCard={onDropCard}
      onTake={async (card) => {
        try { await whatsappApi.take(card.id); toast(`«${card.client_name}» — теперь ваш лид`, "success"); }
        catch (failure) { toast((failure as Error).message || "Не удалось взять лид", "error"); }
        await load(true);
      }} />}
    {pending && <TransitionModal stage={pending.stage} card={pending.card} users={users} rejectReasons={rejectReasons}
      error={transitionError} busy={mutating} onConfirm={confirmTransition}
      onCancel={() => { if (!mutating) { setPending(null); setTransitionError(null); } }} />}
  </>;
}

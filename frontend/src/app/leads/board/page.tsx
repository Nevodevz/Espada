"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Button, Card } from "@/components/ui";
import { LeadBoard } from "@/components/leads/LeadBoard";
import { LeadFiltersBar } from "@/components/leads/LeadFiltersBar";
import { CreateLeadModal } from "@/components/leads/CreateLeadModal";
import { applyOptimisticMove, dropAction, keepFormOnError, shouldPoll } from "@/components/leads/lead-board-layout";
import { TransitionModal } from "@/components/TransitionModal";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { api, leadApi, leadBoardApi, settingsApi, whatsappApi, type BoardQuery } from "@/lib/api";
import {
  EMPTY_LEAD_FILTERS, type LeadBoardCard, type LeadBoardData, type LeadFilters, type LeadSource,
  type LeadStage, type RejectReason, type ServiceItem, type UserWithStats,
} from "@/lib/types";

const POLL_MS = 30_000;
const TOGGLES = [
  { key: "mine", label: "Мои лиды" },
  { key: "unassigned", label: "Неразобранные" },
  { key: "show_closed", label: "Показать закрытые" },
] as const;
type ToggleKey = (typeof TOGGLES)[number]["key"];

function BoardPage() {
  const { user, isAdmin } = useApp();
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<LeadFilters>(() => Object.fromEntries(
    Object.keys(EMPTY_LEAD_FILTERS).map((key) => [key, searchParams.get(key) ?? ""]),
  ) as unknown as LeadFilters);
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>(() => ({
    mine: searchParams.get("mine") === "true",
    unassigned: searchParams.get("unassigned") === "true",
    show_closed: searchParams.get("show_closed") === "true",
  }));
  const [search, setSearch] = useState(filters.search);
  const [data, setData] = useState<LeadBoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const generation = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [rejectReasons, setRejectReasons] = useState<RejectReason[]>([]);
  const [creatingLead, setCreatingLead] = useState(false);
  const [pending, setPending] = useState<{ card: LeadBoardCard; stage: LeadStage } | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(filters.search), 350);
    return () => clearTimeout(timeout);
  }, [filters.search]);
  const query: BoardQuery = useMemo(() => ({
    search, date_from: filters.date_from, date_to: filters.date_to,
    stage_id: filters.stage_id, source_id: filters.source_id, service_id: filters.service_id,
    setter_id: filters.setter_id, closer_id: filters.closer_id, ...toggles,
  }), [search, filters.date_from, filters.date_to, filters.stage_id, filters.source_id,
    filters.service_id, filters.setter_id, filters.closer_id, toggles]);
  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, String(value)); });
    const qs = params.toString();
    router.replace(`/leads/board${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [query, router]);

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
  }, [load]);

  // Background refresh — never under an open dialog or during a change.
  const pollState = useRef({ modalOpen: false, mutating: false });
  pollState.current = { modalOpen: !!pending || creatingLead, mutating };
  useEffect(() => {
    const timer = setInterval(() => {
      if (shouldPoll({ visible: document.visibilityState === "visible", ...pollState.current })) load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    Promise.all([settingsApi.listSources(), settingsApi.listServices(), settingsApi.listStages(), api.listUsers(), settingsApi.listRejectReasons()])
      .then(([nextSources, nextServices, nextStages, nextUsers, nextReasons]) => {
        setSources(nextSources); setServices(nextServices); setStages(nextStages); setUsers(nextUsers); setRejectReasons(nextReasons);
      }).catch(() => toast("Не удалось загрузить справочники для фильтров", "error"));
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

  return <Shell title="Доска">
    <div className="page-head">
      <div className="page-h1">Доска</div>
      <div className="page-desc">Столбцы — этапы воронки. Перетащите лид, чтобы сменить этап; для встречи, договора и оплаты откроется форма.</div>
    </div>
    <LeadFiltersBar filters={filters} onChange={setFilters} sources={sources} services={services} stages={stages} users={users}
      disabled={mutating} actions={<>
        <Button icon="refresh" variant="ghost" disabled={loading || mutating} onClick={() => load()}>Обновить</Button>
        <Button icon="add" disabled={mutating} onClick={() => setCreatingLead(true)}>Новый лид</Button>
      </>} />
    <div role="group" aria-label="Быстрые фильтры" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
      {TOGGLES.map(({ key, label }) => (
        <Button key={key} size="sm" variant={toggles[key] ? "primary" : "ghost"} aria-pressed={toggles[key]}
          onClick={() => setToggles((t) => ({ ...t, [key]: !t[key] }))}>{label}</Button>
      ))}
    </div>
    {error && <Card padding="20px" style={{ marginBottom: 16 }}>
      <div role="alert" style={{ color: "var(--red)", marginBottom: 12 }}>{error}</div>
      <Button variant="ghost" disabled={loading} onClick={() => load()}>Повторить</Button>
    </Card>}
    {!data && loading && <div role="status" style={{ padding: 40, color: "var(--text3)" }}>Загрузка доски…</div>}
    {data && <LeadBoard data={data} disabled={loading || mutating} showClosed={toggles.show_closed} onDropCard={onDropCard}
      onTake={async (card) => {
        try { await whatsappApi.take(card.id); toast(`«${card.client_name}» — теперь ваш лид`, "success"); }
        catch (failure) { toast((failure as Error).message || "Не удалось взять лид", "error"); }
        await load(true);
      }} />}
    {pending && <TransitionModal stage={pending.stage} card={pending.card} users={users} rejectReasons={rejectReasons}
      error={transitionError} busy={mutating} onConfirm={confirmTransition}
      onCancel={() => { if (!mutating) { setPending(null); setTransitionError(null); } }} />}
    <CreateLeadModal open={creatingLead} onClose={() => setCreatingLead(false)} onCreated={() => load()}
      sources={sources} services={services} stages={stages} users={users} currentUserId={user?.id} isAdmin={isAdmin} />
  </Shell>;
}

export default function LeadsBoardPage() {
  return <Suspense fallback={<Shell title="Доска"><div style={{ padding: 40 }}>Загрузка доски…</div></Shell>}><BoardPage /></Suspense>;
}

"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui";
import { CreateLeadModal } from "@/components/leads/CreateLeadModal";
import { LeadBoardView } from "@/components/leads/LeadBoardView";
import { LeadFiltersBar } from "@/components/leads/LeadFiltersBar";
import { LeadListView } from "@/components/leads/LeadListView";
import { useApp } from "@/context/AppContext";
import { analyticsApi, api, leadApi, settingsApi, type BoardQuery } from "@/lib/api";
import { readStoredLeadsView, resolveLeadsView, storeLeadsView, type LeadsView } from "@/lib/leadsView";
import type { LeadFilters, LeadListResponse, LeadSource, LeadStage, ServiceItem, UserWithStats } from "@/lib/types";
import { EMPTY_LEAD_FILTERS } from "@/lib/types";

const LIMIT = 30;
const TOGGLES = [
  { key: "mine", label: "Мои лиды" },
  { key: "unassigned", label: "Неразобранные" },
  { key: "overdue", label: "Просрочено" },
  { key: "no_task", label: "Без задачи" },
  { key: "show_closed", label: "Показать закрытые" },
] as const;
type ToggleKey = (typeof TOGGLES)[number]["key"];

function LeadsPageInner() {
  const { user, isAdmin } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [view, setView] = useState<LeadsView>(() => resolveLeadsView(searchParams.get("view"), readStoredLeadsView()));
  const [filters, setFilters] = useState<LeadFilters>(() => Object.fromEntries(
    Object.keys(EMPTY_LEAD_FILTERS).map((key) => [key, searchParams.get(key) ?? ""]),
  ) as unknown as LeadFilters);
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>(() => ({
    mine: searchParams.get("mine") === "true",
    unassigned: searchParams.get("unassigned") === "true",
    show_closed: searchParams.get("show_closed") === "true",
    overdue: searchParams.get("overdue") === "true",
    no_task: searchParams.get("no_task") === "true",
  }));
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  // Lookups
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [users, setUsers] = useState<UserWithStats[]>([]);

  // List view
  const [listData, setListData] = useState<LeadListResponse>({ items: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [boardKey, setBoardKey] = useState(0);
  const [boardBusy, setBoardBusy] = useState(false);

  // Debounce typing so each keystroke does not hit the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 350);
    return () => clearTimeout(t);
  }, [filters.search]);

  const query: BoardQuery = useMemo(() => ({
    search: debouncedSearch || undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    stage_id: filters.stage_id || undefined,
    source_id: filters.source_id || undefined,
    service_id: filters.service_id || undefined,
    setter_id: filters.setter_id || undefined,
    closer_id: filters.closer_id || undefined,
    ...toggles,
  }), [debouncedSearch, filters.date_from, filters.date_to, filters.stage_id,
       filters.source_id, filters.service_id, filters.setter_id, filters.closer_id, toggles]);

  // Mirror view, filters and toggles into the URL so the state is shareable and restorable.
  useEffect(() => {
    const p = new URLSearchParams({ view });
    for (const [k, v] of Object.entries(query)) {
      if (v) p.set(k, String(v));
    }
    router.replace(`/leads?${p.toString()}`, { scroll: false });
    // `router` identity is stable in the app router; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, view]);

  useEffect(() => {
    settingsApi.listSources().then(setSources).catch(() => {});
    settingsApi.listServices().then(setServices).catch(() => {});
    settingsApi.listStages().then(setStages).catch(() => {});
    api.listUsers().then(setUsers).catch(() => {});
  }, []);

  const load = useCallback(async (nextOffset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const data = await leadApi.list({ ...query, limit: LIMIT, offset: nextOffset });
      setListData(data);
      setOffset(nextOffset);
    } catch (e: unknown) {
      setError((e as Error).message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [query]);

  // The list loads only while it is on screen; the board polls only while it is.
  useEffect(() => { if (view === "list") load(0); }, [load, view]);

  function chooseView(next: LeadsView) {
    setView(next);
    storeLeadsView(next);
  }

  function onCreated() {
    if (view === "list") load(0);
    else setBoardKey((k) => k + 1);
  }

  return (
    <Shell title="Лиды">
      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-h1">Лиды</div>
          <div className="page-desc">
            {view === "board"
              ? "Столбцы — этапы воронки. Перетащите лид, чтобы сменить этап; для встречи, договора и оплаты откроется форма."
              : "Список всех лидов"}
          </div>
        </div>
        <div role="group" aria-label="Вид" style={{ display: "flex", gap: 4 }}>
          <Button size="sm" icon="view_kanban" variant={view === "board" ? "primary" : "ghost"}
            aria-pressed={view === "board"} onClick={() => chooseView("board")}>Доска</Button>
          <Button size="sm" icon="list" variant={view === "list" ? "primary" : "ghost"}
            aria-pressed={view === "list"} onClick={() => chooseView("list")}>Список</Button>
        </div>
      </div>

      <LeadFiltersBar
        filters={filters}
        onChange={setFilters}
        sources={sources}
        services={services}
        stages={stages}
        users={users}
        disabled={view === "board" && boardBusy}
        actions={
          <>
            {view === "board" && (
              <Button icon="refresh" variant="ghost" disabled={boardBusy} onClick={() => setBoardKey((k) => k + 1)}>Обновить</Button>
            )}
            <Button variant="ghost" icon="download" disabled={loading && view === "list"}
              onClick={() => analyticsApi.exportXlsx("leads", {
                ...(filters.date_from ? { date_from: filters.date_from } : {}),
                ...(filters.date_to ? { date_to: filters.date_to } : {}),
              })}>
              Excel
            </Button>
            <Button icon="add" disabled={boardBusy} onClick={() => setCreateModal(true)}>Новый лид</Button>
          </>
        }
      />
      <div role="group" aria-label="Быстрые фильтры" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
        {TOGGLES.map(({ key, label }) => (
          <Button key={key} size="sm" variant={toggles[key] ? "primary" : "ghost"} aria-pressed={toggles[key]}
            onClick={() => setToggles((t) => ({ ...t, [key]: !t[key] }))}>{label}</Button>
        ))}
      </div>

      {view === "board" ? (
        <LeadBoardView query={query} users={users} refreshKey={boardKey} onBusyChange={setBoardBusy} />
      ) : (
        <LeadListView
          data={listData}
          loading={loading}
          error={error}
          offset={offset}
          limit={LIMIT}
          onPage={(next) => load(next)}
          onRetry={() => load(offset)}
        />
      )}

      <CreateLeadModal
        open={createModal}
        onClose={() => setCreateModal(false)}
        onCreated={onCreated}
        sources={sources}
        services={services}
        stages={stages}
        users={users}
        currentUserId={user?.id}
        isAdmin={isAdmin}
      />
    </Shell>
  );
}

export default function LeadsPage() {
  // useSearchParams needs a Suspense boundary during static rendering.
  return (
    <Suspense fallback={<Shell title="Лиды"><div style={{ padding: 40, color: "var(--text3)" }}>Загрузка…</div></Shell>}>
      <LeadsPageInner />
    </Suspense>
  );
}

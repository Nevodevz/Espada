"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Button, Card } from "@/components/ui";
import { CreateLeadModal } from "@/components/leads/CreateLeadModal";
import { LeadFiltersBar } from "@/components/leads/LeadFiltersBar";
import { LeadListView } from "@/components/leads/LeadListView";
import { useApp } from "@/context/AppContext";
import { analyticsApi, api, leadApi, settingsApi, type LeadQuery } from "@/lib/api";
import { fmtMoneyShort } from "@/lib/format";
import type {
  FunnelStats, LeadFilters, LeadListResponse, LeadSource, LeadStage,
  LeadStats, ServiceItem, UserWithStats,
} from "@/lib/types";
import { EMPTY_LEAD_FILTERS } from "@/lib/types";

const LIMIT = 30;

function KpiCard({ label, value, icon, color }: {
  label: string; value: string | number; icon?: string; color?: string;
}) {
  return (
    <Card style={{ minWidth: 140, flex: "1 1 140px" }} padding="16px 20px">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text3)", fontSize: 12, marginBottom: 2 }}>
          {icon && <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>}
          {label}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: color ?? "var(--text1)" }}>{value}</div>
      </div>
    </Card>
  );
}

function filtersFromParams(params: URLSearchParams): LeadFilters {
  const read = (k: keyof LeadFilters) => params.get(k) ?? "";
  return {
    search: read("search"),
    date_from: read("date_from"),
    date_to: read("date_to"),
    stage_id: read("stage_id"),
    source_id: read("source_id"),
    service_id: read("service_id"),
    setter_id: read("setter_id"),
    closer_id: read("closer_id"),
  };
}

function LeadsPageInner() {
  const { user, isAdmin } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  // The funnel kanban moved to the stage board; keep old links working.
  useEffect(() => {
    if (searchParams.get("view") === "funnel") router.replace("/leads/board");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filters, setFilters] = useState<LeadFilters>(() => filtersFromParams(new URLSearchParams(searchParams.toString())));
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  // Lookups
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [stages, setStages] = useState<LeadStage[]>([]);
  const [users, setUsers] = useState<UserWithStats[]>([]);

  // List view
  const [listData, setListData] = useState<LeadListResponse>({ items: [], total: 0 });
  const [offset, setOffset] = useState(0);

  const [funnelStats, setFunnelStats] = useState<FunnelStats | null>(null);

  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState(false);

  // Debounce typing so each keystroke does not hit the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 350);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Mirror filters into the URL so the state is shareable and restorable.
  useEffect(() => {
    if (searchParams.get("view") === "funnel") return;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, search: debouncedSearch })) {
      if (v) p.set(k, String(v));
    }
    const qs = p.toString();
    router.replace(qs ? `/leads?${qs}` : "/leads", { scroll: false });
    // `router` identity is stable in the app router; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.date_from, filters.date_to, filters.stage_id, filters.source_id,
      filters.service_id, filters.setter_id, filters.closer_id, debouncedSearch]);

  const query: LeadQuery = useMemo(() => ({
    search: debouncedSearch || undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    stage_id: filters.stage_id || undefined,
    source_id: filters.source_id || undefined,
    service_id: filters.service_id || undefined,
    setter_id: filters.setter_id || undefined,
    closer_id: filters.closer_id || undefined,
  }), [debouncedSearch, filters.date_from, filters.date_to, filters.stage_id,
       filters.source_id, filters.service_id, filters.setter_id, filters.closer_id]);

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
      const [data, s, fStats] = await Promise.all([
        leadApi.list({ ...query, limit: LIMIT, offset: nextOffset }),
        leadApi.stats({ date_from: filters.date_from || undefined, date_to: filters.date_to || undefined }),
        leadApi.funnelStats(query),
      ]);
      setListData(data);
      setStats(s);
      setFunnelStats(fStats);
      setOffset(nextOffset);
    } catch (e: unknown) {
      setError((e as Error).message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [query, filters.date_from, filters.date_to]);

  useEffect(() => { load(0); }, [load]);

  const kpis = (
    <>
      <KpiCard label="Лидов сегодня" value={stats?.leads_today ?? "—"} icon="today" />
      <KpiCard label="Лидов за период" value={stats?.leads_period ?? "—"} icon="contacts" />
      <KpiCard label="Встреч за период" value={stats?.meetings_period ?? "—"} icon="calendar_month" />
      <KpiCard label="Закрыто в оплату" value={stats?.closed_won ?? "—"} icon="payments" />
      <KpiCard label="Конверсия" value={stats ? `${stats.conversion_pct}%` : "—"} icon="trending_up" />
      <KpiCard label="Сумма сделок" value={stats ? fmtMoneyShort(stats.deals_sum) : "—"} icon="account_balance_wallet" />
      <KpiCard label="Оплачено" value={stats ? fmtMoneyShort(stats.paid_sum) : "—"} icon="paid" color="var(--green)" />
      <KpiCard label="Остаток" value={stats ? fmtMoneyShort(stats.remaining_sum) : "—"} icon="pending" color="var(--yellow)" />
    </>
  );
  const funnelKpis = (
    <>
      <KpiCard label="Новых лидов" value={funnelStats?.new_leads ?? "—"} />
      <KpiCard label="На встрече" value={funnelStats?.meetings_stage ?? "—"} color="var(--primary)" />
      <KpiCard label="Договоров" value={funnelStats?.contracts_sent ?? "—"} />
      <KpiCard label="Ожид. оплату" value={funnelStats?.waiting_payment ?? "—"} color="var(--yellow)" />
      <KpiCard label="Закрыто" value={funnelStats?.closed_won ?? "—"} color="var(--green)" />
      <KpiCard label="Конверсия" value={funnelStats ? `${funnelStats.conversion_pct}%` : "—"} color="var(--primary)" />
      <KpiCard label="Сумма сделок" value={funnelStats ? fmtMoneyShort(funnelStats.deals_sum) : "—"} />
      <KpiCard label="Остаток" value={funnelStats ? fmtMoneyShort(funnelStats.remaining_sum) : "—"} color="var(--yellow)" />
    </>
  );

  return (
    <Shell title="Лиды и воронка">
      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-h1">Лиды и воронка</div>
          <div className="page-desc">Список всех лидов и показатели воронки · работа с этапами — на доске</div>
        </div>
        <Button variant="ghost" icon="view_kanban" onClick={() => router.push("/leads/board")}>Открыть доску</Button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>{kpis}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>{funnelKpis}</div>

      <LeadFiltersBar
        filters={filters}
        onChange={setFilters}
        sources={sources}
        services={services}
        stages={stages}
        users={users}
        actions={
          <>
            <Button variant="ghost" icon="download" disabled={loading}
              onClick={() => analyticsApi.exportXlsx("leads", {
                ...(filters.date_from ? { date_from: filters.date_from } : {}),
                ...(filters.date_to ? { date_to: filters.date_to } : {}),
              })}>
              Excel
            </Button>
            <Button icon="add" onClick={() => setCreateModal(true)}>Новый лид</Button>
          </>
        }
      />

      <LeadListView
        data={listData}
        loading={loading}
        error={error}
        offset={offset}
        limit={LIMIT}
        onPage={(next) => load(next)}
        onRetry={() => load(offset)}
      />

      <CreateLeadModal
        open={createModal}
        onClose={() => setCreateModal(false)}
        onCreated={() => load(0)}
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
    <Suspense fallback={<Shell title="Лиды и воронка"><div style={{ padding: 40, color: "var(--text3)" }}>Загрузка…</div></Shell>}>
      <LeadsPageInner />
    </Suspense>
  );
}

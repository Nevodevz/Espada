"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { Button, Card, DateRangePicker, Select } from "@/components/ui";
import { ChartCard, DailyRevenueChart, DailyTrendChart, FunnelViz, SourcesPie } from "@/components/charts/SalesCharts";
import { DiaryArchive } from "@/components/sales/DiaryArchive";
import { EmployeesTable } from "@/components/sales/EmployeesTable";
import { MetricsTotals } from "@/components/sales/MetricsTotals";
import { useApp } from "@/context/AppContext";
import { api, salesHubApi, settingsApi } from "@/lib/api";
import { todayBishkek } from "@/lib/format";
import { METRICS_PRESETS, presetRange, type MetricsPreset } from "@/lib/metricsPeriod";
import { isSalesHead } from "@/lib/roles";
import type { LeadSource, SalesMetrics, ServiceItem, UserWithStats } from "@/lib/types";

const PERIOD_ONLY = "Только период: фильтры источника, услуги и сотрудника сюда не применяются.";

export default function SalesMetricsPage() {
  const { user } = useApp();
  const head = !!user && isSalesHead(user);

  const [preset, setPreset] = useState<MetricsPreset>("month");
  const [range, setRange] = useState(() => presetRange("month", todayBishkek())!);
  const [sourceId, setSourceId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [userId, setUserId] = useState("");

  const [sources, setSources] = useState<LeadSource[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [users, setUsers] = useState<UserWithStats[]>([]);

  const [data, setData] = useState<SalesMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    settingsApi.listSources().then(setSources).catch(() => {});
    settingsApi.listServices().then(setServices).catch(() => {});
  }, []);
  useEffect(() => {
    if (head) api.listUsers().then((us) => setUsers(us.filter((u) => u.is_active !== false))).catch(() => {});
  }, [head]);

  function choosePreset(p: MetricsPreset) {
    setPreset(p);
    const r = presetRange(p, todayBishkek());
    if (r) setRange(r);
  }

  const complete = !!range.from && !!range.to && range.from <= range.to;
  const query = useMemo(() => ({
    date_from: range.from,
    date_to: range.to,
    source_id: sourceId ? Number(sourceId) : undefined,
    service_id: serviceId ? Number(serviceId) : undefined,
    user_id: head && userId ? Number(userId) : undefined,
  }), [range.from, range.to, sourceId, serviceId, userId, head]);

  useEffect(() => {
    if (!user || !complete) return;
    let alive = true;
    setLoading(true);
    salesHubApi.metrics(query)
      .then((d) => { if (alive) { setData(d); setError(null); setDenied(false); } })
      .catch((e: unknown) => {
        if (!alive) return;
        if ((e as { status?: number }).status === 403) setDenied(true);
        else setError((e as Error).message || "Не удалось загрузить показатели");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user, complete, query]);

  if (denied) {
    return (
      <Shell title="Отдел продаж">
        <Card padding="24px" style={{ color: "var(--text3)", textAlign: "center" }}>Раздел доступен только сотрудникам отдела продаж.</Card>
      </Shell>
    );
  }

  return (
    <Shell title="Отдел продаж">
      <div className="page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="page-h1">Показатели</div>
          <div className="page-desc">Статистика продаж из CRM{head ? "" : " — ваши показатели и общие итоги"}</div>
        </div>
      </div>

      {/* Period + filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div role="group" aria-label="Период" style={{ display: "flex", gap: 4 }}>
          {METRICS_PRESETS.map((p) => (
            <Button key={p.key} size="sm" variant={preset === p.key ? "primary" : "ghost"} aria-pressed={preset === p.key}
              onClick={() => choosePreset(p.key)}>{p.label}</Button>
          ))}
        </div>
        {preset === "custom" && (
          <DateRangePicker value={range} onChange={(v) => setRange(v)} />
        )}
        <div style={{ minWidth: 160 }}>
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="Источник">
            <option value="">Все источники</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div style={{ minWidth: 160 }}>
          <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)} aria-label="Услуга">
            <option value="">Все услуги</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        {head && (
          <div style={{ minWidth: 170 }}>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Сотрудник">
              <option value="">Все сотрудники</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
        )}
      </div>

      {!complete && <Card padding="16px" style={{ marginBottom: 14, color: "var(--text3)" }}>Выберите даты «с» и «по».</Card>}
      {error && <Card padding="16px" style={{ marginBottom: 14, color: "var(--red)" }}>{error}</Card>}
      {complete && loading && !data && <div style={{ padding: 30, color: "var(--text3)" }}>Загрузка…</div>}

      {complete && data && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity 0.15s" }}>
          <MetricsTotals totals={data.totals} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16 }}>
            <ChartCard title="Воронка: лиды по этапам сейчас"
              hint="Все лиды на своих текущих этапах; справа — переход с предыдущего этапа. Период и фильтры не применяются.">
              <FunnelViz data={data.funnel} />
            </ChartCard>
            <ChartCard title="Источники лидов за период" hint={`Лиды, созданные в периоде, по источникам. ${PERIOD_ONLY}`}>
              <SourcesPie data={data.sources} />
            </ChartCard>
            <ChartCard title="Лиды, встречи, продажи по дням за период"
              hint={`Лиды — по дате создания, встречи — по дате встречи, продажи — оплаченные сделки по дате оплаты. ${PERIOD_ONLY}`}>
              <DailyTrendChart data={data.daily} />
            </ChartCard>
            <ChartCard title="Выручка по дням за период" hint={`Оплачено по сделкам по дате оплаты. ${PERIOD_ONLY}`}>
              <DailyRevenueChart data={data.daily} />
            </ChartCard>
          </div>

          <div className="section-label" style={{ marginTop: 8 }}>По сотрудникам</div>
          <EmployeesTable setters={data.employees.setters} closers={data.employees.closers} />

          <DiaryArchive dateFrom={range.from} dateTo={range.to}
            userId={head ? (userId ? Number(userId) : undefined) : user?.id} />
        </div>
      )}
    </Shell>
  );
}

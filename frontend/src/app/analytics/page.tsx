"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Shell } from "@/components/Shell";
import { useApp } from "@/context/AppContext";
import { analyticsApi } from "@/lib/api";
import type { DashboardMetrics, ChartsData, Problem } from "@/lib/types";
import { Button, DateRangePicker, PageHeader } from "@/components/ui";
import { ChartCard, EmptyChart, PieWithLegend, fmtCompact, fmtSom } from "@/components/charts/SalesCharts";

function KpiCard({
  label, value, sub, icon, color,
}: {
  label: string; value: string | number; sub?: string; icon: string; color?: string;
}) {
  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6, flex: "1 1 160px", minWidth: 160 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text3)", fontSize: 12 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: color || "var(--accent)" }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text3)" }}>{sub}</div>}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { color: string; label: string }> = {
    critical: { color: "var(--red)",     label: "Критично" },
    error:    { color: "var(--yellow)",  label: "Ошибка" },
    warning:  { color: "var(--primary)", label: "Внимание" },
  };
  const { color, label } = map[severity] || { color: "var(--text3)", label: severity };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, color,
      background: color + "22",
      borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap",
    }}>{label}</span>
  );
}

export default function AnalyticsPage() {
  const { user: me } = useApp();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [charts, setCharts] = useState<ChartsData | null>(null);
  const [probs, setProbs] = useState<Problem[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (me && me.role !== "admin" && !me.is_founder) {
      router.replace("/dashboard");
    }
  }, [me, router]);

  const load = () => {
    setLoading(true);
    analyticsApi.dashboard(dateFrom || undefined, dateTo || undefined)
      .then(d => {
        setMetrics(d.metrics);
        setCharts(d.charts);
        setProbs(d.problems);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  if (me && me.role !== "admin" && !me.is_founder) return null;

  return (
    <Shell title="Аналитика">
      <PageHeader
        title="CEO Dashboard"
        subtitle="Сводные показатели бизнеса. Лиды, встречи и продажи — в «Отдел продаж → Показатели»"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <DateRangePicker
              value={{ from: dateFrom, to: dateTo }}
              onChange={v => { setDateFrom(v.from); setDateTo(v.to); }}
              onReset={() => { setDateFrom(""); setDateTo(""); }}
            />
            <Button variant="primary" onClick={load}>Применить</Button>
          </div>
        }
      />

      {loading && (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>Загрузка...</div>
      )}

      {!loading && metrics && (
        <>
          {/* Problems */}
          {probs.length > 0 && (
            <div className="card" style={{ padding: "14px 20px", marginBottom: 16, borderLeft: "3px solid var(--red)" }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6, color: "var(--red)" }}>warning</span>
                Проблемы ({probs.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {probs.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <SeverityBadge severity={p.severity} />
                    <span style={{ fontSize: 13, color: "var(--text2)", flex: 1 }}>{p.message}</span>
                    {p.link && (
                      <a href={p.link} style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>→ Открыть</a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sales metrics (leads, meetings, sales, conversions, funnel, sources) live on /sales/metrics. */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <KpiCard label="CPL (месяц)" value={fmtSom(metrics.cpl)} icon="ads_click" color="var(--yellow)" />
            <KpiCard label="CAC (месяц)" value={fmtSom(metrics.cac)} icon="price_change" color="var(--red)" />
            <KpiCard
              label="Выручка месяца"
              value={fmtSom(metrics.revenue_month)}
              sub={metrics.plan_revenue_month > 0 ? `План: ${fmtSom(metrics.plan_revenue_month)} · ${metrics.revenue_vs_plan_pct ?? 0}%` : undefined}
              icon="payments"
              color="var(--green)"
            />
            <KpiCard label="Средний чек" value={fmtSom(metrics.avg_check)} icon="receipt" />
            <KpiCard label="На счетах" value={fmtSom(metrics.total_on_accounts)} icon="account_balance" />
            <KpiCard label="В ожидании оплаты" value={fmtSom(metrics.pending_amount)} sub={`${metrics.pending_count} сделок`} icon="pending_actions" color="var(--yellow)" />
            <KpiCard label="Расходы месяца" value={fmtSom(metrics.expenses_month)} icon="trending_down" color="var(--red)" />
            <KpiCard label="ФОТ месяца" value={fmtSom(metrics.fot_month)} icon="group" color="var(--red)" />
            <KpiCard
              label="Прибыль месяца"
              value={fmtSom(metrics.profit_month)}
              icon="trending_up"
              color={metrics.profit_month >= 0 ? "var(--green)" : "var(--red)"}
            />
            <KpiCard
              label="Прогноз 7 дней"
              value={fmtSom(metrics.cashflow_7d)}
              sub={metrics.cashflow_warning ? "⚠ Возможен разрыв" : "Норма"}
              icon="savings"
              color={metrics.cashflow_warning ? "var(--red)" : "var(--green)"}
            />
          </div>

          {charts && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <ChartCard title="Расходы по категориям">
                <PieWithLegend data={charts.expense_categories.map(c => ({
                  name: c.name, value: c.amount ?? 0, label: fmtSom(c.amount ?? 0),
                }))} />
              </ChartCard>
              <ChartCard title="Выручка по услугам">
                {charts.revenue_by_service.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={charts.revenue_by_service} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 80 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={fmtCompact} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip formatter={(v: any) => [fmtSom(Number(v)), "Выручка"]} />
                      <Bar dataKey="revenue" fill="#4648d4" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyChart />}
              </ChartCard>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

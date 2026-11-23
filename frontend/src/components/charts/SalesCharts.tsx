"use client";

// Charts shared by «Показатели» (/sales/metrics) and «Аналитика» (/analytics).
// Extracted unchanged from app/analytics/page.tsx.
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import type { DailyPoint, FunnelPoint } from "@/lib/types";

export const PIE_COLORS = ["#4648d4", "#16a34a", "#e03b3b", "#f59e0b", "#06b6d4", "#8b5cf6", "#ec4899", "#84cc16"];

/** Compact axis label: 1.2M, 150K. */
export function fmtCompact(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

export function fmtSom(n: number) {
  return new Intl.NumberFormat("ru-KG").format(n) + " с";
}

/** Card with a title; `hint` goes to the title attribute so the semantics are one hover away. */
export function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }} title={hint}>
        {title}
        {hint && <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--text3)", verticalAlign: "middle", marginLeft: 4, cursor: "help" }}>info</span>}
      </div>
      {children}
    </div>
  );
}

export function EmptyChart() {
  return <div style={{ color: "var(--text3)", fontSize: 13 }}>Нет данных за период</div>;
}

/** Stage bars with step-to-step conversion; lost stages are left out. */
export function FunnelViz({ data }: { data: FunnelPoint[] }) {
  const active = data.filter(d => !d.is_lost);
  const max = Math.max(...active.map(d => d.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {active.map((stage, i) => {
        const prev = i > 0 ? active[i - 1].count : null;
        const conv = prev && prev > 0 ? Math.round(stage.count / prev * 100) : null;
        const pct = Math.max(stage.count / max * 100, 4);
        return (
          <div key={stage.stage_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 120, fontSize: 12, color: "var(--text2)", textAlign: "right", flexShrink: 0 }}>
              {stage.stage_name}
            </div>
            <div style={{ flex: 1, background: "var(--bg2)", borderRadius: 4, height: 26, position: "relative" }}>
              <div style={{
                width: `${pct}%`, height: "100%", borderRadius: 4,
                background: stage.is_won ? "var(--green)" : (stage.color || "var(--primary)"),
                display: "flex", alignItems: "center", paddingLeft: 8,
                transition: "width 0.4s",
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{stage.count}</span>
              </div>
            </div>
            {conv !== null && (
              <div style={{ width: 36, fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>{conv}%</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Leads / meetings / sales per day. */
export function DailyTrendChart({ data }: { data: DailyPoint[] }) {
  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 0, right: 10, bottom: 0, left: -20 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip labelFormatter={v => String(v)} formatter={(v, name) => [v, name === "leads" ? "Лиды" : name === "meetings" ? "Встречи" : "Продажи"]} />
          <Line type="monotone" dataKey="leads" stroke="#4648d4" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="meetings" stroke="#f59e0b" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="sales" stroke="#16a34a" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "var(--text3)" }}>
        <span><span style={{ color: "#4648d4" }}>●</span> Лиды</span>
        <span><span style={{ color: "#f59e0b" }}>●</span> Встречи</span>
        <span><span style={{ color: "#16a34a" }}>●</span> Продажи</span>
      </div>
    </>
  );
}

/** Paid revenue per day. */
export function DailyRevenueChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 0, right: 10, bottom: 0, left: -20 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtCompact} />
        <Tooltip formatter={(v: any) => [fmtSom(Number(v)), "Выручка"]} />
        <Bar dataKey="revenue" fill="#4648d4" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface PieSlice { name: string; value: number; label: string; legendLabel?: string }

/** Donut with a legend; `label` is the tooltip text, `legendLabel` (default `label`) the legend text. */
export function PieWithLegend({ data }: { data: PieSlice[] }) {
  if (data.length === 0) return <EmptyChart />;
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <ResponsiveContainer width={170} height={170}>
        <PieChart>
          <Pie data={data} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={50}>
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(_v: any, _n: any, p: any) => [p.payload.label, p.payload.name]} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        {data.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
            <span style={{ flex: 1, color: "var(--text2)" }}>{s.name}</span>
            <span style={{ color: "var(--text3)" }}>{s.legendLabel ?? s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lead sources donut: «count (pct%)». */
export function SourcesPie({ data }: { data: { name: string; count?: number; pct?: number }[] }) {
  return <PieWithLegend data={data.map(s => ({ name: s.name, value: s.count ?? 0, label: `${s.count ?? 0} (${s.pct ?? 0}%)` }))} />;
}

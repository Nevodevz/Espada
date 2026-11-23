"use client";

import { fmtMoney } from "@/lib/format";
import { conversions } from "@/lib/salesConversions";
import type { SalesMetricsTotals } from "@/lib/types";

// Short label + a hover hint with the exact counting rule (spec §5.4, §5.4.2).
const TILES: { key: keyof SalesMetricsTotals; label: string; hint: string; money?: boolean; pct?: boolean }[] = [
  { key: "leads", label: "Лидов", hint: "Лиды, созданные в периоде (без архивных)" },
  { key: "meetings_booked", label: "Встреч назначено", hint: "Исходные встречи, созданные в периоде (перенос не считается второй раз)" },
  { key: "meetings_held", label: "Встреч проведено", hint: "Встречи со статусом «Закрыт», «Минус» или «Дожим» и датой встречи в периоде" },
  { key: "sales", label: "Продаж", hint: "Оплаченные сделки по дате оплаты в периоде" },
  { key: "conversion_pct", label: "Конверсия лид→продажа", pct: true, hint: "Лиды, созданные в периоде и дошедшие до этапа «Оплачено», делённые на всех лидов периода" },
  { key: "deals_amount", label: "Сумма сделок", money: true, hint: "Сумма сделок по открытым лидам, созданным в периоде" },
  { key: "paid", label: "Оплачено", money: true, hint: "Оплачено по сделкам открытых лидов, созданных в периоде" },
  { key: "remaining", label: "Остаток", money: true, hint: "Сумма сделок минус оплачено (по открытым лидам, созданным в периоде)" },
];

const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`);

/** Step conversions (moved from the /analytics strip): ratios of the totals above, same period and filters. */
function ConversionStrip({ totals }: { totals: SalesMetricsTotals }) {
  const c = conversions(totals);
  const items = [
    { label: "Лид → встреча", value: c.leadToMeeting,
      hint: "Встречи, проведённые в периоде, делённые на лидов, созданных в периоде (разные когорты: может быть больше 100%)" },
    { label: "Встреча → продажа", value: c.meetingToSale,
      hint: "Оплаченные сделки по дате оплаты в периоде, делённые на встречи, проведённые в периоде" },
  ];
  return (
    <div className="card" style={{ padding: "10px 16px", marginBottom: 16, display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)" }}>Конверсии</div>
      {items.map((i) => (
        <div key={i.label} title={i.hint} style={{ fontSize: 13, cursor: "help" }}>{i.label}: <b>{fmtPct(i.value)}</b></div>
      ))}
    </div>
  );
}

export function MetricsTotals({ totals }: { totals: SalesMetricsTotals }) {
  return (
    <>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 10 }}>
      {TILES.map((t) => {
        const v = totals[t.key];
        const text = t.money ? fmtMoney(v, "с") : t.pct ? `${v}%` : String(v);
        return (
          <div key={t.key} className="card" title={t.hint} style={{ padding: "12px 14px", cursor: "help" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>{t.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>{text}</div>
          </div>
        );
      })}
    </div>
    <ConversionStrip totals={totals} />
    </>
  );
}

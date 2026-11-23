"use client";

import { fmtMoneyShort } from "@/lib/format";
import { MEETING_STATUS } from "@/lib/types";
import type { CloserMetricsRow, CloserOutcome, SetterMetricsRow } from "@/lib/types";

const num: React.CSSProperties = { textAlign: "right", fontFamily: "JetBrains Mono, monospace" };

const SETTER_COLS: { key: keyof SetterMetricsRow; label: string; hint: string }[] = [
  { key: "touches", label: "Касаний", hint: "Сотрудник × лид × день: звонок с результатом, исходящее WhatsApp или ручное касание" },
  { key: "calls_connected", label: "Дозвонов", hint: "Результаты звонков «дозвонился» за период" },
  { key: "calls_no_answer", label: "Недозвонов", hint: "Результаты звонков «не дозвонился» за период" },
  { key: "booked", label: "Назначено встреч", hint: "Исходные встречи сеттера, созданные в периоде" },
  { key: "held", label: "Проведено встреч", hint: "Встречи сеттера со статусом «Закрыт», «Минус» или «Дожим» и датой встречи в периоде" },
];

const CLOSER_OUTCOMES: CloserOutcome[] = ["scheduled", "closed", "minus", "push", "not_held"];

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div title={hint} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "help" }}>
        {title}
      </div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

function EmptyRow() {
  return <tr><td colSpan={99} style={{ textAlign: "center", color: "var(--text3)", padding: 20 }}>Нет данных за период</td></tr>;
}

/** Per-employee table of «Показатели»: setters and closers (spec §5.4). Period only, filters do not apply. */
export function EmployeesTable({ setters, closers }: { setters: SetterMetricsRow[]; closers: CloserMetricsRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 16 }}>
      <Section title="Сеттеры за период" hint="Сотрудники с хотя бы одним значением за период. Фильтры источника и услуги не применяются.">
        <table className="data-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              {SETTER_COLS.map((c) => <th key={c.key} title={c.hint} style={{ textAlign: "right", cursor: "help" }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {setters.map((r) => (
              <tr key={r.user_id}>
                <td>{r.name || "—"}</td>
                {SETTER_COLS.map((c) => <td key={c.key} style={num}>{r[c.key]}</td>)}
              </tr>
            ))}
            {setters.length === 0 && <EmptyRow />}
          </tbody>
        </table>
      </Section>

      <Section title="Клоузеры за период" hint="Встречи клоузера по статусам — по дате встречи в периоде, без переносов. Продажи — оплаченные сделки по дате оплаты.">
        <table className="data-table">
          <thead>
            <tr>
              <th>Клоузер</th>
              {CLOSER_OUTCOMES.map((s) => <th key={s} style={{ textAlign: "right", color: MEETING_STATUS[s].color }}>{MEETING_STATUS[s].label}</th>)}
              <th style={{ textAlign: "right" }} title="Оплаченные сделки клоузера по дате оплаты">Продаж</th>
              <th style={{ textAlign: "right" }} title="Оплачено по этим сделкам">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {closers.map((r) => (
              <tr key={r.user_id}>
                <td>{r.name || "—"}</td>
                {CLOSER_OUTCOMES.map((s) => <td key={s} style={{ ...num, color: MEETING_STATUS[s].color }}>{r.by_status[s] ?? 0}</td>)}
                <td style={{ ...num, fontWeight: 600 }}>{r.sales}</td>
                <td style={num}>{fmtMoneyShort(r.sales_amount)}</td>
              </tr>
            ))}
            {closers.length === 0 && <EmptyRow />}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { LostReasonRow } from "@/lib/types";

const num: React.CSSProperties = { textAlign: "right", fontFamily: "JetBrains Mono, monospace" };

/** «Причины отказа за период»: reason · count · share, expandable by setter. */
export function LostReasonsCard({ rows }: { rows: LostReasonRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const keyOf = (r: LostReasonRow) => String(r.reason_id ?? "none");

  return (
    <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Причины отказа за период
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr><th>Причина</th><th style={num}>Лидов</th><th style={num}>Доля</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--text3)", padding: 20 }}>Нет данных за период</td></tr>
            )}
            {rows.map((r) => {
              const k = keyOf(r);
              const expanded = open === k;
              return [
                <tr key={k}>
                  <td>
                    <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : k)}
                      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }}>
                      {expanded ? "▾" : "▸"} {r.name}
                    </button>
                  </td>
                  <td style={num}>{r.count}</td>
                  <td style={num}>{r.pct}%</td>
                </tr>,
                ...(expanded ? r.by_user.map((u) => (
                  <tr key={`${k}-${u.user_id}`} style={{ color: "var(--text3)" }}>
                    <td style={{ paddingLeft: 32 }}>{u.name}</td>
                    <td style={num}>{u.count}</td>
                    <td />
                  </tr>
                )) : []),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

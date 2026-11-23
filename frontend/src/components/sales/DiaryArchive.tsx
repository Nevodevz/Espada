"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { ColumnDef, SalesRecord } from "@/lib/types";

const PAGE = 100;

/**
 * Read-only view of the old manual sales diary (`sales_records`) for the selected period.
 * Collapsed by default and loaded only when opened; manual entry is gone from the UI (spec §5.4).
 */
export function DiaryArchive({ dateFrom, dateTo, userId }: { dateFrom: string; dateTo: string; userId?: number }) {
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true); setError(null);
    Promise.all([
      api.salesColumns(),
      api.salesRecords({ date_from: dateFrom, date_to: dateTo, user_id: userId, limit: PAGE }),
    ])
      .then(([cols, recs]) => {
        if (!alive) return;
        setColumns(cols);
        setRecords(recs);
        setHasMore(recs.length === PAGE);
      })
      .catch((e: Error) => { if (alive) setError(e.message || "Не удалось загрузить архив"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, dateFrom, dateTo, userId]);

  async function loadMore() {
    setLoading(true);
    try {
      const more = await api.salesRecords({ date_from: dateFrom, date_to: dateTo, user_id: userId, limit: PAGE, offset: records.length });
      setRecords((r) => [...r, ...more]);
      setHasMore(more.length === PAGE);
    } catch (e: unknown) {
      setError((e as Error).message || "Не удалось загрузить архив");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", color: "var(--text2)", fontSize: 13, fontWeight: 600, textAlign: "left" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>chevron_right</span>
        <span style={{ flex: 1 }}>Архив дневника (ручной ввод)</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text3)" }}>только просмотр, за выбранный период</span>
      </button>
      {open && (
        <div style={{ borderTop: "1px solid var(--border)", overflowX: "auto" }}>
          {error && <div style={{ padding: 16, color: "var(--red)", fontSize: 13 }}>{error}</div>}
          {!error && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата</th><th>Сотрудник</th>
                  {columns.map((c) => <th key={c.id} style={{ textAlign: "right" }}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>{fmtDate(r.record_date)}</td>
                    <td>{r.user?.name ?? "—"}</td>
                    {columns.map((c) => <td key={c.id} style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace" }}>{r.metrics[c.key] ?? "—"}</td>)}
                  </tr>
                ))}
                {!loading && records.length === 0 && (
                  <tr><td colSpan={columns.length + 2} style={{ textAlign: "center", color: "var(--text3)", padding: 20 }}>Нет записей за период</td></tr>
                )}
              </tbody>
            </table>
          )}
          {loading && <div style={{ padding: 12, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>Загрузка…</div>}
          {!loading && hasMore && (
            <button onClick={loadMore}
              style={{ width: "100%", padding: 11, background: "transparent", border: "none", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--primary)", cursor: "pointer", fontFamily: "inherit" }}>
              Загрузить ещё
            </button>
          )}
        </div>
      )}
    </div>
  );
}

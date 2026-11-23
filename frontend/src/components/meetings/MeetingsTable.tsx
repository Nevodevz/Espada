"use client";

import { useCallback, useEffect, useState } from "react";
import { MeetingDetailModal } from "@/components/meetings/MeetingDetailModal";
import { closerOptions, isCloser } from "@/lib/roles";
import { meetingApi } from "@/lib/api";
import {
  Meeting, MeetingStatus, MEETING_STATUS, MEETING_STATUS_KEYS, UserWithStats,
} from "@/lib/types";
import { Select, DateRangePicker } from "@/components/ui";


function periodRange(period: "day" | "week" | "month"): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === "day") { const t = iso(now); return { from: t, to: t }; }
  if (period === "week") {
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const mon = new Date(now); mon.setDate(now.getDate() - dow);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: iso(mon), to: iso(sun) };
  }
  return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: iso(now) };
}

// ISO UTC string → "YYYY-MM-DDTHH:MM" in Bishkek (+6h)
function utcToLocal(s: string): string {
  const Y = +s.slice(0, 4), Mo = +s.slice(5, 7) - 1, D = +s.slice(8, 10);
  const h = +s.slice(11, 13), m = +s.slice(14, 16);
  const ld = new Date(Date.UTC(Y, Mo, D, h, m) + 6 * 3600 * 1000);
  return `${ld.getUTCFullYear()}-${String(ld.getUTCMonth() + 1).padStart(2, "0")}-${String(ld.getUTCDate()).padStart(2, "0")}T${String(ld.getUTCHours()).padStart(2, "0")}:${String(ld.getUTCMinutes()).padStart(2, "0")}`;
}
function fmtDatetime(d: string) {
  const [date, time] = utcToLocal(d).split("T");
  const [Y, M, Dd] = date.split("-");
  return `${Dd}.${M}.${Y} ${time}`;
}

/** Meetings table: period / role / status filters, status count cards, list. A plain page block. */
export function MeetingsTable({ allUsers, initUser = null, currentUser, isAdmin, maxHeight = 460 }: {
  allUsers: UserWithStats[];
  initUser?: UserWithStats | null;
  currentUser: UserWithStats | undefined;
  isAdmin: boolean;
  /** Max height of the scrolling table area, px. */
  maxHeight?: number;
}) {
  const setters = allUsers.filter((u) => u.position === "Сеттер" || u.position === "Руководитель продаж");
  const closers = closerOptions(allUsers);

  const [period, setPeriod] = useState<"day" | "week" | "month" | "custom">("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [filterStatus, setFilterStatus] = useState<MeetingStatus | "">("");
  const [filterRole, setFilterRole] = useState<"setter" | "closer" | "all">(() => {
    if (!initUser) return "all";
    if (isCloser(initUser)) return "closer";
    return "setter";
  });
  const [filterUserId, setFilterUserId] = useState<string>(() => initUser ? String(initUser.id) : "");

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const LIMIT = 100;

  const { from, to } = period === "custom"
    ? { from: customFrom, to: customTo }
    : periodRange(period);

  function handleRoleChange(r: "setter" | "closer" | "all") {
    setFilterRole(r);
    setFilterUserId("");
  }

  const userListForRole = filterRole === "setter" ? setters : filterRole === "closer" ? closers : [];

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const params: Parameters<typeof meetingApi.list>[0] = {
        date_from: from || undefined,
        date_to: to || undefined,
        limit: LIMIT,
        offset: off,
      };
      if (filterUserId) {
        const uid = Number(filterUserId);
        if (filterRole === "setter") params.setter_id = uid;
        else if (filterRole === "closer") params.closer_id = uid;
      }
      const data = await meetingApi.list(params);
      const filtered = filterStatus ? data.filter((m) => m.status === filterStatus) : data;
      if (off === 0) setMeetings(filtered);
      else setMeetings((prev) => [...prev, ...filtered]);
      setHasMore(data.length === LIMIT);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [from, to, filterUserId, filterRole, filterStatus]);

  useEffect(() => { setOffset(0); load(0); }, [load]);

  const counts = Object.fromEntries(MEETING_STATUS_KEYS.map((k) => [k, 0])) as Record<MeetingStatus, number>;
  for (const m of meetings) counts[m.status] = (counts[m.status] ?? 0) + 1;

  const titleName = initUser ? `Встречи — ${initUser.name}` : "Все встречи";
  return (
    <div>
      {/* ── Filters row ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* Period */}
        <div style={{ display: "flex", gap: 4, background: "var(--bg3)", borderRadius: 8, padding: 3 }}>
          {(["day", "week", "month", "custom"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{
                padding: "4px 12px", borderRadius: 6, border: "none",
                background: period === p ? "var(--bg2)" : "transparent",
                boxShadow: period === p ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                color: period === p ? "var(--text)" : "var(--text3)",
                fontSize: 12, fontWeight: period === p ? 600 : 400, cursor: "pointer", fontFamily: "inherit",
              }}>
              {{ day: "День", week: "Неделя", month: "Месяц", custom: "Период" }[p]}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <DateRangePicker
            value={{ from: customFrom, to: customTo }}
            onChange={v => { setCustomFrom(v.from); setCustomTo(v.to); }}
            onReset={() => { setCustomFrom(""); setCustomTo(""); }}
          />
        )}

        <div style={{ minWidth: 150 }}>
          <Select value={filterRole} onChange={(e) => handleRoleChange(e.target.value as any)}>
            <option value="all">Все участники</option>
            <option value="setter">По сеттеру</option>
            <option value="closer">По клоузеру</option>
          </Select>
        </div>

        {filterRole !== "all" && (
          <div style={{ minWidth: 150 }}>
            <Select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
              <option value="">— Все —</option>
              {userListForRole.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
        )}

        <div style={{ minWidth: 150 }}>
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
            <option value="">Все статусы</option>
            {MEETING_STATUS_KEYS.map((s) => <option key={s} value={s}>{MEETING_STATUS[s].label}</option>)}
          </Select>
        </div>
      </div>

      {/* ── Stats cards ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ padding: "10px 16px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)", minWidth: 80 }}>
          <div style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Всего</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", fontFamily: "JetBrains Mono, monospace" }}>{meetings.length}</div>
        </div>
        {MEETING_STATUS_KEYS.map((s) => {
          const st = MEETING_STATUS[s];
          return (
            <div key={s} onClick={() => setFilterStatus(filterStatus === s ? "" : s)}
              style={{
                padding: "10px 16px", background: st.bg, borderRadius: 8,
                border: `1.5px solid ${filterStatus === s ? st.color : st.color + "33"}`,
                minWidth: 80, cursor: "pointer", transition: "border-color 0.15s",
              }}>
              <div style={{ fontSize: 10, color: st.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{st.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: st.color, fontFamily: "JetBrains Mono, monospace" }}>{counts[s]}</div>
            </div>
          );
        })}
      </div>

      {/* ── Table ── */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ overflowX: "auto", maxHeight, overflowY: "auto" }}>
          <table className="data-table" style={{ position: "relative" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg3)" }}>
              <tr>
                <th>Дата</th>
                <th>Клиент</th>
                <th>Телефон</th>
                <th>Сеттер</th>
                <th>Клоузер</th>
                <th>Статус</th>
                <th>Адрес</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => {
                const st = MEETING_STATUS[m.status];
                return (
                  <tr key={m.id} onClick={() => setSelectedMeeting(m)} style={{ cursor: "pointer" }}>
                    <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, whiteSpace: "nowrap" }}>
                      {fmtDatetime(m.meeting_date)}
                    </td>
                    <td style={{ fontWeight: 500, color: "var(--text)" }}>{m.client_name}</td>
                    <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text2)" }}>{m.client_phone || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--text2)" }}>{m.setter?.name ?? "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--text2)" }}>{m.closer?.name ?? "—"}</td>
                    <td>
                      <span className="status-chip" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </td>
                    <td style={{ color: "var(--text3)", fontSize: 12 }}>{m.address || "—"}</td>
                  </tr>
                );
              })}
              {!loading && meetings.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text3)", padding: "30px 20px" }}>Нет встреч</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && <div style={{ padding: "14px 20px", textAlign: "center", fontSize: 13, color: "var(--text3)" }}>Загрузка…</div>}
        {hasMore && !loading && (
          <button className="load-more-btn" onClick={() => { const n = offset + LIMIT; setOffset(n); load(n); }}>
            Загрузить ещё
          </button>
        )}
      </div>


      {selectedMeeting && (
        <MeetingDetailModal
          open
          onClose={() => setSelectedMeeting(null)}
          onSaved={async () => {
            const updated = await meetingApi.get(selectedMeeting.id).catch(() => null);
            if (updated) setSelectedMeeting(updated);
            load(0);
          }}
          onDeleted={() => { setSelectedMeeting(null); load(0); }}
          meeting={selectedMeeting}
          closers={closers}
          currentUser={currentUser}
          isAdmin={isAdmin}
          onStatusChanged={(updated) => setSelectedMeeting(updated)}
        />
      )}
      <style jsx global>{`
        .data-table { width: 100%; border-collapse: collapse; }
        .data-table thead { background: var(--bg3); }
        .data-table th { padding: 11px 16px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text3); border-bottom: 1px solid var(--border); white-space: nowrap; }
        .data-table td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--border); color: var(--text2); }
        .data-table tr:last-child td { border-bottom: none; }
        .data-table tbody tr:hover td { background: var(--bg-hover); }
        .load-more-btn { width: 100%; padding: 11px; background: transparent; border: none; border-top: 1px solid var(--border); font-size: 12px; color: var(--primary); cursor: pointer; font-family: inherit; }
        .load-more-btn:hover { background: var(--bg-hover); }
        .status-chip { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; }
      `}</style>
    </div>
  );
}

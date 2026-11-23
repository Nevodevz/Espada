"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { MeetingsTable } from "@/components/meetings/MeetingsTable";
import { SalesMeetingsCalendar } from "@/components/meetings/SalesMeetingsCalendar";
import { useApp } from "@/context/AppContext";
import { api } from "@/lib/api";
import { isCloser } from "@/lib/roles";
import type { Department, UserWithStats } from "@/lib/types";

type View = "calendar" | "table";

function MeetingsPageInner() {
  const { isAdmin, user } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: View = searchParams.get("view") === "table" ? "table" : "calendar";

  const [dept, setDept] = useState<Department | null>(null);
  const [currentUser, setCurrentUser] = useState<UserWithStats | undefined>();
  const [allUsers, setAllUsers] = useState<UserWithStats[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDepartment("sales").then(setDept).catch((e: Error) => setError(e.message || "Не удалось загрузить отдел продаж"));
    api.listUsers().then(setAllUsers).catch(() => {});
  }, []);
  useEffect(() => { if (user) api.getUser(user.id).then(setCurrentUser).catch(() => {}); }, [user]);

  function setView(v: View) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", v);
    router.replace(`/sales/meetings?${params.toString()}`);
  }

  const ready = !!user && !!dept;

  return (
    <Shell title="Отдел продаж">
      <div className="page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="page-h1">Встречи</div>
        <div style={{ display: "flex", gap: 4, background: "var(--bg3)", borderRadius: 8, padding: 3 }}>
          {(["calendar", "table"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              style={{
                padding: "5px 14px", borderRadius: 6, border: "none",
                background: view === v ? "var(--bg2)" : "transparent",
                boxShadow: view === v ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                color: view === v ? "var(--text)" : "var(--text3)",
                fontSize: 12, fontWeight: view === v ? 600 : 400, cursor: "pointer", fontFamily: "inherit",
              }}>
              {v === "calendar" ? "Календарь" : "Таблица"}
            </button>
          ))}
        </div>
      </div>
      {error && <Card padding="16px" style={{ marginBottom: 14, color: "var(--red)" }}>{error}</Card>}
      {!ready && !error && <div style={{ padding: 30, color: "var(--text3)" }}>Загрузка…</div>}
      {ready && view === "calendar" && (
        <SalesMeetingsCalendar dept={dept} isAdmin={isAdmin} currentUser={currentUser}
          defaultCloserId={isCloser(user) ? user.id : undefined} />
      )}
      {ready && view === "table" && (
        <MeetingsTable allUsers={allUsers} currentUser={currentUser} isAdmin={isAdmin} maxHeight={620} />
      )}
    </Shell>
  );
}

export default function MeetingsPage() {
  return <Suspense fallback={<Shell title="Отдел продаж"><div style={{ padding: 30 }}>Загрузка…</div></Shell>}><MeetingsPageInner /></Suspense>;
}

"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { MyTasksBlock } from "@/components/sales/MyTasksBlock";
import { UnclaimedLeadsBlock } from "@/components/sales/UnclaimedLeadsBlock";
import { AwaitingReplyBlock } from "@/components/sales/AwaitingReplyBlock";
import { useToast } from "@/context/ToastContext";
import { salesHubApi, whatsappApi } from "@/lib/api";
import type { SalesToday } from "@/lib/types";

const POLL_MS = 60_000;

export default function TodayPage() {
  const toast = useToast();
  const [data, setData] = useState<SalesToday | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      setData(await salesHubApi.today());
    } catch (e: unknown) {
      // 403: not sales staff — show only the tasks block, no error.
      if ((e as { status?: number }).status === 403) setData(null);
    }
    setNow(new Date());
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const take = async (leadId: number) => {
    try {
      await whatsappApi.take(leadId);
      await load();
    } catch (e: unknown) {
      toast((e as Error).message || "Не удалось взять лид", "error");
      load();
    }
  };

  return (
    <Shell title="Отдел продаж">
      <div className="today-grid">
        <div><Suspense fallback={<div style={{ padding: 30 }}>Загрузка…</div>}><MyTasksBlock /></Suspense></div>
        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <UnclaimedLeadsBlock items={data.unclaimed} now={now} onTake={take} />
            <AwaitingReplyBlock items={data.awaiting_reply} now={now} />
          </div>
        )}
      </div>
      <style jsx>{`
        .today-grid { display: grid; grid-template-columns: ${data ? "minmax(0, 3fr) minmax(0, 2fr)" : "minmax(0, 1fr)"}; gap: 18px; align-items: start; }
        @media (max-width: 900px) { .today-grid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </Shell>
  );
}

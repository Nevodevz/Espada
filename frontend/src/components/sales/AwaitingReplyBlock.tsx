"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { formatWaiting } from "@/lib/waiting";
import type { AwaitingReplyItem } from "@/lib/types";

export function AwaitingReplyBlock({ items, now }: { items: AwaitingReplyItem[]; now: Date }) {
  return (
    <Card padding="16px 18px">
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Клиент написал, мы не ответили · {items.length}</div>
      {items.length === 0 && <div style={{ color: "var(--text3)", fontSize: 13 }}>Пусто</div>}
      {items.map((r) => (
        <Link key={r.lead_id} href={`/leads/${r.lead_id}`} style={{ display: "block", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontWeight: 600 }}>{r.client_name}</span>
            <span style={{ color: "var(--red)", fontSize: 12, whiteSpace: "nowrap" }}>{formatWaiting(r.last_at, new Date(now))}</span>
          </div>
          {r.last_body && <div style={{ color: "var(--text3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.last_body}</div>}
        </Link>
      ))}
    </Card>
  );
}

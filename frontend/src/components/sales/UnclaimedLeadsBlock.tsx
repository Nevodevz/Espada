"use client";

import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { formatWaitingMinutes } from "@/lib/waiting";
import type { UnclaimedLead } from "@/lib/types";

export function UnclaimedLeadsBlock({ items, onTake }: {
  items: UnclaimedLead[]; onTake: (leadId: number) => void;
}) {
  return (
    <Card padding="16px 18px">
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Новые лиды, никто не взял · {items.length}</div>
      {items.length === 0 && <div style={{ color: "var(--text3)", fontSize: 13 }}>Пусто</div>}
      {items.map((l) => (
        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
          <Link href={`/leads/${l.id}`} style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>{l.client_name}</div>
            <div style={{ color: "var(--text3)", fontSize: 12 }}>
              {[l.phone, l.source_name, formatWaitingMinutes(l.waiting_minutes)].filter(Boolean).join(" · ")}
            </div>
          </Link>
          <Button variant="primary" onClick={() => onTake(l.id)}>Взять</Button>
        </div>
      ))}
    </Card>
  );
}

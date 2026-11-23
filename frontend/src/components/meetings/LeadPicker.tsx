"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui";
import { leadApi } from "@/lib/api";
import type { Lead } from "@/lib/types";

const DEBOUNCE_MS = 300;

/**
 * Client picker for a new meeting: searches open leads, the last row creates
 * a new client from the typed text. `value` is the name of the chosen client
 * (empty = nothing chosen yet).
 */
export function LeadPicker({
  value, onPick, onCreateNew, onClear, autoFocus,
}: {
  value: string;
  onPick: (lead: Lead) => void;
  onCreateNew: (text: string) => void;
  onClear?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Lead[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (value || !open) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      leadApi
        .list({ open_only: true, search: text.trim() || undefined, limit: 8 })
        .then((r) => { if (my === seq.current) { setItems(r.items); setError(false); } })
        .catch(() => { if (my === seq.current) { setItems([]); setError(true); } });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, open, value]);

  if (value) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          flex: 1, padding: "7px 10px", fontSize: 13, border: "0.5px solid var(--border)",
          borderRadius: 8, background: "var(--bg3)", color: "var(--text)",
        }}>
          {value}
        </div>
        <button type="button" onClick={() => { setText(""); setItems([]); onClear?.(); }}
          style={{ fontSize: 12, color: "var(--text2)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          Сменить
        </button>
      </div>
    );
  }

  const typed = text.trim();
  const row: React.CSSProperties = {
    display: "block", width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13,
    background: "transparent", border: "none", borderBottom: "0.5px solid var(--border)",
    color: "var(--text)", cursor: "pointer", fontFamily: "inherit",
  };

  return (
    <div style={{ position: "relative" }}>
      <Input
        value={text}
        autoFocus={autoFocus}
        placeholder="Найти лида по имени или телефону"
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div role="listbox" style={{
          position: "absolute", left: 0, right: 0, top: "100%", zIndex: 20, marginTop: 4,
          background: "var(--bg2)", border: "0.5px solid var(--border)", borderRadius: 8,
          maxHeight: 260, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.25)",
        }}>
          {error && <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--red)" }}>Не удалось загрузить лидов</div>}
          {items.map((l) => (
            <button key={l.id} type="button" role="option" aria-selected={false} style={row}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setOpen(false); onPick(l); }}>
              {[l.client_name, l.phone, l.stage?.name, l.setter?.name].filter(Boolean).join(" · ")}
            </button>
          ))}
          {typed && (
            <button type="button" style={{ ...row, color: "var(--green)", borderBottom: "none" }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setOpen(false); onCreateNew(typed); }}>
              + Новый клиент «{typed}»
            </button>
          )}
          {!typed && items.length === 0 && !error && (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--text3)" }}>Начните вводить имя или телефон</div>
          )}
        </div>
      )}
    </div>
  );
}

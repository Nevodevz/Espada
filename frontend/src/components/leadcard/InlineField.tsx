"use client";

import { useEffect, useRef, useState } from "react";

export type InlineKind = "text" | "number" | "select" | "textarea";

const visuallyHidden: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden",
  clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
};

// A value that turns into an input in place (spec §5.5 «клик — поле ввода»). The value and its
// pencil are one real button, so a click on the value — or Enter/Space on focus — starts editing;
// a select opens its list right away where the browser allows it. Enter or blur saves, Esc
// cancels. On a failed save the previous value comes back and the error text is shown under the field.
export function InlineField({ label, value, display, kind = "text", options, onSave, bare = false, placeholder = "добавить…", ariaLabel, extra }: {
  label?: string;
  value: string;
  display?: React.ReactNode;
  kind?: InlineKind;
  options?: { value: string; label: string }[];
  onSave: (raw: string) => Promise<void>;
  bare?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Interactive content shown next to the value (kept outside the edit button). */
  extra?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);
  const name = ariaLabel ?? label ?? "поле";

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    // One interaction for selects: open the list right away (still inside the click's user activation).
    if (el instanceof HTMLSelectElement) {
      try { (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.(); } catch { /* not supported */ }
    }
  }, [editing]);

  function start() {
    finished.current = false;
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    finished.current = true;
    setEditing(false);
    setDraft(value);
  }

  async function commit(next: string) {
    if (finished.current) return;
    finished.current = true;
    if (next === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (e: unknown) {
      setError((e as Error).message || "Не удалось сохранить");
      setEditing(false);
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
    if (e.key === "Enter" && (kind !== "textarea" || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit(draft);
    }
  }

  const shown = display ?? (value || null);
  const empty = shown === null || shown === "" || shown === undefined;

  const control = kind === "select" ? (
    <select ref={(el) => { inputRef.current = el; }} className="form-input" aria-label={name} value={draft} disabled={saving}
      style={{ width: "auto", maxWidth: 220 }}
      onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
      onBlur={() => commit(draft)} onKeyDown={onKeyDown}>
      <option value="">—</option>
      {(options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ) : kind === "textarea" ? (
    <textarea ref={(el) => { inputRef.current = el; }} className="form-input" aria-label={name} rows={3} value={draft} disabled={saving}
      style={{ resize: "vertical" }}
      onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(draft)} onKeyDown={onKeyDown} />
  ) : (
    <input ref={(el) => { inputRef.current = el; }} className="form-input" aria-label={name} value={draft} disabled={saving}
      type="text" inputMode={kind === "number" ? "numeric" : undefined}
      style={{ maxWidth: 220, textAlign: bare ? "left" : "right" }}
      onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(draft)} onKeyDown={onKeyDown} />
  );

  const view = (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, minWidth: 0, justifyContent: bare ? "flex-start" : "flex-end" }}>
      <button type="button" className="inline-field-view" onClick={start} title="Изменить"
        style={{
          display: "inline-flex", alignItems: "baseline", gap: 6, minWidth: 0, border: "none", background: "none",
          padding: 0, margin: 0, font: "inherit", textAlign: "inherit", cursor: "pointer", color: "inherit",
          justifyContent: bare ? "flex-start" : "flex-end",
        }}>
        <span style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: kind === "textarea" ? "pre-wrap" : undefined, color: empty ? "var(--text3)" : "var(--text1)" }}>
          {empty ? placeholder : shown}
        </span>
        <span aria-hidden="true" className="inline-field-pencil" style={{ color: "var(--text3)", fontSize: 12, lineHeight: 1 }}>✎</span>
        <span style={visuallyHidden}>{`Изменить: ${name}`}</span>
      </button>
      {extra}
    </span>
  );

  const body = (
    <div style={{ minWidth: 0, textAlign: bare ? "left" : "right" }}>
      {editing ? control : view}
      {error && <div role="alert" style={{ color: "var(--red)", fontSize: 12, marginTop: 2 }}>{error}</div>}
    </div>
  );

  if (bare) return <div className="inline-field" style={{ display: "inline-block" }}>{body}</div>;
  return (
    <div className="inline-field" style={{ display: "flex", flexDirection: kind === "textarea" ? "column" : "row", justifyContent: "space-between", alignItems: kind === "textarea" ? "stretch" : "baseline", gap: kind === "textarea" ? 4 : 10, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
      {label && <span style={{ color: "var(--text3)", flexShrink: 0 }}>{label}</span>}
      {body}
    </div>
  );
}

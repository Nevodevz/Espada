"use client";

// Column editor for the department tables (marketing). Moved unchanged from the removed SalesDepartmentView.
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/context/ToastContext";
import type { ColumnDef } from "@/lib/types";
import { Button, Input, Select, ConfirmModal } from "@/components/ui";

export function ColumnsModal({ open, onClose, onSaved, columns, addFn, delFn, reorderFn }: any) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("number");
  const [deleteColId, setDeleteColId] = useState<number | null>(null);

  async function add() {
    if (!label.trim()) return;
    try { await addFn({ label, kind }); setLabel(""); onSaved(); toast("Колонка добавлена"); }
    catch (e: any) { toast(e.message, "error"); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Колонки таблицы" width={420}
      footer={<Button variant="ghost" onClick={onClose}>Закрыть</Button>}>
      <div style={{ marginBottom: 16 }}>
        {columns.map((c: ColumnDef) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 13, color: "var(--text)" }}>{c.label} <span style={{ color: "var(--text3)", fontSize: 11 }}>({c.kind === "number" ? "число" : "текст"})</span></span>
            <div style={{ display: "flex", gap: 2 }}>
              {reorderFn && <>
                <button className="row-act" onClick={async () => { try { await reorderFn(c.id, "left"); onSaved(); } catch {} }}><span className="material-symbols-outlined" style={{ fontSize: 17 }}>arrow_back</span></button>
                <button className="row-act" onClick={async () => { try { await reorderFn(c.id, "right"); onSaved(); } catch {} }}><span className="material-symbols-outlined" style={{ fontSize: 17 }}>arrow_forward</span></button>
              </>}
              <button className="row-act" onClick={() => setDeleteColId(c.id)}><span className="material-symbols-outlined" style={{ fontSize: 17 }}>delete</span></button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text2)", marginBottom: 6, userSelect: "none" }}>Новая колонка</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Название" />
        </div>
        <div style={{ minWidth: 110, flexShrink: 0 }}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="number">Число</option>
            <option value="text">Текст</option>
          </Select>
        </div>
        <Button onClick={add}>Добавить</Button>
      </div>

      <ConfirmModal
        open={deleteColId !== null}
        title="Удалить колонку?"
        message="Данные этой колонки будут удалены."
        confirmLabel="Удалить"
        variant="danger"
        onConfirm={async () => {
          if (deleteColId !== null) {
            try { await delFn(deleteColId); onSaved(); } catch (e: any) { toast(e.message, "error"); }
            setDeleteColId(null);
          }
        }}
        onCancel={() => setDeleteColId(null)}
      />
    </Modal>
  );
}

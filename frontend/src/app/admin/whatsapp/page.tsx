"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Button, Card, ConfirmModal } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { whatsappApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { WhatsAppChat, WhatsAppConnect, WhatsAppStatus } from "@/lib/types";

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  open: { label: "Подключён", color: "var(--green)" },
  connecting: { label: "Подключается — отсканируйте QR", color: "var(--yellow)" },
  close: { label: "Отключён", color: "var(--red)" },
  refused: { label: "Отключён (QR не отсканирован)", color: "var(--red)" },
  unknown: { label: "Неизвестно", color: "var(--text3)" },
};

export default function WhatsAppAdminPage() {
  const { isAdmin, user } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [qr, setQr] = useState<WhatsAppConnect | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [chats, setChats] = useState<WhatsAppChat[]>([]);

  const loadStatus = useCallback(async () => {
    try { setStatus(await whatsappApi.status()); } catch { /* shown as unknown */ }
  }, []);
  const loadChats = useCallback(async () => {
    try { setChats(await whatsappApi.otherChats()); } catch { /* not critical */ }
  }, []);

  useEffect(() => { if (isAdmin) { loadStatus(); loadChats(); } }, [isAdmin, loadStatus, loadChats]);

  // While a QR is shown, poll until the phone has scanned it.
  useEffect(() => {
    if (!qr || status?.state === "open") return;
    const timer = setInterval(loadStatus, 3000);
    return () => clearInterval(timer);
  }, [qr, status?.state, loadStatus]);
  useEffect(() => { if (status?.state === "open") setQr(null); }, [status?.state]);

  // WhatsApp rotates the QR roughly every 20 s: fetch a fresh one while it is on screen.
  const showingQr = !!qr;
  useEffect(() => {
    if (!showingQr || status?.state === "open") return;
    const timer = setInterval(async () => {
      try {
        const next = await whatsappApi.connect();
        setQr(next.state === "open" ? null : next);
      } catch { /* keep the current QR; the next tick retries */ }
    }, 15_000);
    return () => clearInterval(timer);
  }, [showingQr, status?.state]);

  async function connect() {
    setBusy(true);
    try {
      const result = await whatsappApi.connect();
      setQr(result.state === "open" ? null : result);
      await loadStatus();
    } catch (e: unknown) {
      toast((e as Error).message || "Не удалось подключить", "error");
    } finally { setBusy(false); }
  }

  async function logout() {
    setLogoutConfirm(false);
    setBusy(true);
    try { await whatsappApi.logout(); setQr(null); await loadStatus(); toast("Номер отключён", "success"); }
    catch (e: unknown) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  }

  async function chatAction(action: () => Promise<unknown>, done: string) {
    try { await action(); toast(done, "success"); loadChats(); }
    catch (e: unknown) { toast((e as Error).message, "error"); }
  }

  if (user && !isAdmin) {
    return <Shell title="WhatsApp"><Card padding="24px">Раздел доступен только администраторам.</Card></Shell>;
  }

  const state = status ? (status.configured ? status.state : "not_configured") : "unknown";
  const view = STATE_LABELS[state] ?? (state === "not_configured"
    ? { label: "Не настроено — задайте EVOLUTION_URL на сервере", color: "var(--text3)" }
    : STATE_LABELS.unknown);

  return (
    <Shell title="WhatsApp">
      <div className="page-head">
        <div className="page-h1">WhatsApp отдела продаж</div>
        <div className="page-desc">Подключение общего номера. Не подключайте номер отдела к тестовым или локальным стендам.</div>
      </div>

      <Card padding="20px" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: view.color }} />
          <strong style={{ color: "var(--text)" }}>{view.label}</strong>
          {status?.updated_at && <span style={{ fontSize: 12, color: "var(--text3)" }}>обновлено {fmtDateTime(status.updated_at)}</span>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button variant="ghost" disabled={busy} onClick={loadStatus}>Обновить</Button>
            {status?.configured && state !== "open" && <Button loading={busy} disabled={busy} onClick={connect}>Подключить</Button>}
            {status?.configured && state === "open" && <Button variant="danger" disabled={busy} onClick={() => setLogoutConfirm(true)}>Отключить</Button>}
          </div>
        </div>
        {qr && (
          <div style={{ marginTop: 20, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            {qr.qr_base64
              ? <img src={qr.qr_base64} alt="QR-код для подключения WhatsApp" style={{ width: 260, height: 260, background: "#fff", padding: 8, borderRadius: 8 }} />
              : <div style={{ color: "var(--text3)" }}>QR ещё не готов — нажмите «Подключить» ещё раз через пару секунд.</div>}
            <ol style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.7, margin: 0 }}>
              <li>Откройте WhatsApp на телефоне отдела.</li>
              <li>Настройки → Связанные устройства → Привязка устройства.</li>
              <li>Наведите камеру на QR-код.</li>
              {qr.pairing_code && <li>Или войдите по коду: <b>{qr.pairing_code}</b></li>}
            </ol>
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 16, marginBottom: 0 }}>
          Подключение неофициальное: не делайте массовых рассылок и не пишите первыми большому числу незнакомых номеров — номер могут заблокировать.
        </p>
      </Card>

      <Card padding="20px">
        <div style={{ fontWeight: 600, marginBottom: 12, color: "var(--text)" }}>Прочие чаты</div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
          Номера без лида (написали с телефона отдела) и помеченные «Не лид».
        </div>
        {!chats.length && <div style={{ color: "var(--text3)", fontSize: 13 }}>Пусто</div>}
        {chats.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ color: "var(--text)", fontSize: 13 }}>{c.push_name || "Без имени"} · +{c.phone}</div>
              <div style={{ color: "var(--text3)", fontSize: 12 }}>
                {c.is_ignored ? "Не лид" : "Без лида"}{c.last_message_at ? ` · ${fmtDateTime(c.last_message_at)}` : ""}
                {c.lead_id && <> · <Link href={`/leads/${c.lead_id}`}>лид #{c.lead_id}</Link></>}
              </div>
            </div>
            {c.is_ignored && <Button size="sm" variant="ghost" onClick={() => chatAction(() => whatsappApi.unignore(c.id), "Пометка снята")}>Вернуть</Button>}
            <Button size="sm" onClick={() => chatAction(() => whatsappApi.makeLead(c.id), "Лид создан")}>Сделать лидом</Button>
          </div>
        ))}
      </Card>

      <ConfirmModal open={logoutConfirm} title="Отключить номер?" variant="danger" confirmLabel="Отключить"
        message="Новые сообщения перестанут приходить в CRM, пока номер не подключат заново по QR."
        onConfirm={logout} onCancel={() => setLogoutConfirm(false)} />
    </Shell>
  );
}

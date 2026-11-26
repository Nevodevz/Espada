"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { telegramApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { normalizeUsername } from "@/lib/telegramSettings";
import type { TelegramCloser, TelegramGroup, TelegramSettings } from "@/lib/types";

const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 8 };
const section: React.CSSProperties = { padding: "14px 0", borderTop: "0.5px solid var(--border)" };

function CloserRow({ closer, onSaved }: { closer: TelegramCloser; onSaved: (username: string) => void }) {
  const toast = useToast();
  const [value, setValue] = useState(closer.telegram_username);
  useEffect(() => setValue(closer.telegram_username), [closer.telegram_username]);

  async function commit() {
    const next = normalizeUsername(value);
    setValue(next);
    if (next === closer.telegram_username) return;
    try {
      const res = await telegramApi.saveCloser(closer.id, next);
      onSaved(res.telegram_username);
      toast("Ник сохранён", "success");
    } catch (e: any) {
      toast(e.message || "Не удалось сохранить ник", "error");
      setValue(closer.telegram_username);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <div style={{ flex: 1, fontSize: 13 }}>{closer.name}</div>
      <div style={{ width: 200 }}>
        <Input
          value={value}
          placeholder="@ник"
          aria-label={`Ник Telegram: ${closer.name}`}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
      </div>
    </div>
  );
}

export function TelegramSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [cfg, setCfg] = useState<TelegramSettings | null>(null);
  const [token, setToken] = useState("");
  const [groups, setGroups] = useState<TelegramGroup[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGroups(null);
    setToken("");
    telegramApi.get().then(setCfg).catch((e) => toast(e.message || "Не удалось загрузить настройки", "error"));
  }, [open, toast]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, "success");
    } catch (e: any) {
      toast(e.message || "Ошибка", "error");
    } finally {
      setBusy(false);
    }
  }

  const connected = !!cfg?.bot_username;
  const hasGroup = !!cfg?.chat_id;

  return (
    <Modal open={open} onClose={onClose} title="Напоминания в Telegram" width={640}
      footer={<Button variant="primary" onClick={onClose}>Готово</Button>}>
      {!cfg ? <div style={{ color: "var(--text3)" }}>Загрузка…</div> : (
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, paddingBottom: 12 }}>
            <input
              type="checkbox" checked={cfg.enabled} disabled={busy}
              onChange={(e) => run(async () => setCfg(await telegramApi.update({ enabled: e.target.checked })))}
            />
            Напоминания включены
          </label>
          {cfg.last_error && (
            <div style={{ color: "var(--red)", fontSize: 12, paddingBottom: 8 }}>
              Последняя отправка не удалась: {cfg.last_error}{cfg.last_error_at ? ` (${fmtDateTime(cfg.last_error_at)})` : ""}
            </div>
          )}

          <div style={section}>
            <div style={sectionTitle}>1. Бот</div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Input
                  value={token} aria-label="Токен бота"
                  placeholder={cfg.token_tail ? `•••• ${cfg.token_tail}` : "Токен от @BotFather"}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <Button variant="primary" disabled={busy || !token.trim()}
                onClick={() => run(async () => { setCfg(await telegramApi.saveToken(token.trim())); setToken(""); setGroups(null); }, "Бот подключён")}>
                Сохранить
              </Button>
            </div>
            {connected && <div style={{ color: "var(--green)", fontSize: 12, marginTop: 6 }}>✓ Бот @{cfg.bot_username} подключён</div>}
          </div>

          <div style={section}>
            <div style={sectionTitle}>2. Группа</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
              Добавьте бота в группу и напишите там любое сообщение, затем нажмите «Найти группы».
            </div>
            {hasGroup && <div style={{ fontSize: 13, marginBottom: 8 }}>Выбрана группа: <b>{cfg.chat_title || cfg.chat_id}</b></div>}
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" icon="search" disabled={busy || !connected}
                onClick={() => run(async () => {
                  const found = await telegramApi.findGroups();
                  setGroups(found);
                  if (!found.length) toast("Групп не найдено. Напишите сообщение в группе с ботом и повторите", "info");
                })}>
                Найти группы
              </Button>
              <Button variant="ghost" icon="send" disabled={busy || !hasGroup}
                onClick={() => run(() => telegramApi.sendTest(), "Тестовое сообщение отправлено")}>
                Отправить тест
              </Button>
            </div>
            {groups && groups.length > 0 && (
              <div role="radiogroup" aria-label="Группа" style={{ marginTop: 8 }}>
                {groups.map((g) => (
                  <label key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                    <input
                      type="radio" name="tg-group" checked={cfg.chat_id === g.id} disabled={busy}
                      onChange={() => run(async () => setCfg(await telegramApi.update({ chat_id: g.id, chat_title: g.title })))}
                    />
                    {g.title || g.id}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={section}>
            <div style={sectionTitle}>3. Клоузеры</div>
            {cfg.closers.length === 0 && <div style={{ fontSize: 12, color: "var(--text3)" }}>Нет активных клоузеров</div>}
            {cfg.closers.map((c) => (
              <CloserRow key={c.id} closer={c}
                onSaved={(u) => setCfg((p) => p && ({ ...p, closers: p.closers.map((x) => x.id === c.id ? { ...x, telegram_username: u } : x) }))} />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

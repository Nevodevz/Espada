# Напоминания о встречах в Telegram · План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Бот CRM пишет в Telegram-группу отдела продаж утреннюю сводку встреч дня и напоминание за 1,5 часа до каждой встречи; токен, группа и ники клоузеров настраиваются руководителем продаж в окне на странице «Встречи».

**Architecture:** Бэкенд: настройки в одной строке БД, отметки отправки в таблице с уникальным ключом, Telegram Bot API через `httpx`, фоновый цикл раз в минуту в `lifespan`. Эндпоинты настроек — под `/api/sales-hub/telegram`. Фронтенд: окно `TelegramSettingsModal` на `/sales/meetings`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, httpx, pytest; Next.js 14, vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-telegram-meeting-reminders-design.md`

## Global Constraints

- Ветка `feat/telegram-meeting-reminders`, PR в `dev`. В коммитах не упоминать Claude.
- Время — Бишкек, `BISHKEK = timezone(timedelta(hours=6))`. Сводка — в **10:00**, каждый день, только если встречи есть. Напоминание — за **90 минут**.
- Только встречи `status == MeetingStatus.scheduled` с `closer_id` или без — все запланированные.
- Права на настройки — руководитель продаж (`is_sales_head`), иначе 403.
- Токен наружу не отдаётся никогда: только `token_tail` — последние 4 символа.
- Внешние вызовы Telegram — `timeout=10` с.
- Тесты: `cd backend && .venv/Scripts/python -m pytest tests/<file> -q`; `cd frontend && npm test`, `npx tsc --noEmit`. `npm run build` запускает только контролёр при остановленном dev-сервере. Не коммитить `frontend/tsconfig.tsbuildinfo`.

## Review Focus

1. Встречу перенесли на другое время после отправки напоминания → по новому времени придёт ещё одно (ключ содержит время встречи) — тест в Task 2.
2. Имя клиента или адрес с `<`, `&` → сообщение не ломается (HTML-экранирование) — тест в Task 2.
3. Telegram отвечает ошибкой (бот удалён из группы) → отметка снимается, `last_error` заполнен, следующий тик пробует снова; цикл не падает — тест в Task 2.
4. Сервер запустился в 12:00 → сводка всё равно уходит в этот день один раз; встреча, начавшаяся без напоминания (сервер лежал), не напоминается задним числом — тест в Task 2.
5. Смена токена на другого бота → выбранная группа сбрасывается (новый бот в ней не состоит) — тест в Task 3.

---

### Task 1: Модели, миграция, Telegram-клиент

**Files:**
- Modify: `backend/app/models/__init__.py` (рядом с `WhatsAppState`; поле у `User`)
- Create: `backend/migrations/versions/027_telegram_reminders.py` (revision `"027"`, down `"026"`)
- Create: `backend/app/services/telegram/__init__.py`, `backend/app/services/telegram/client.py`
- Test: `backend/tests/test_telegram_client.py`

**Interfaces:**
- Produces:
  - `User.telegram_username: Mapped[str]` — `String(64)`, default `""`, server_default `""`.
  - `TelegramSettings` (`telegram_settings`, одна строка `id=1`): `enabled: bool` (default False), `bot_token: str` (`String(100)`, ""), `bot_username: str` (""), `chat_id: str` (`String(32)`, ""), `chat_title: str` (`String(200)`, ""), `last_error: str` (`Text`, ""), `last_error_at: datetime | None`, `updated_at: datetime | None`.
  - `TelegramSent` (`telegram_sent`): `id`, `key: str` (`String(120)`, **unique**), `sent_at: datetime` (server_default now).
  - `class TelegramError(Exception)` — текст ошибки на русском, пригодный для показа.
  - `class TelegramClient(token: str, http: httpx.Client | None = None)`:
    `get_me() -> str` (username бота), `find_groups() -> list[dict]` (`[{"id": str, "title": str}]` — чаты `group`/`supergroup` из `getUpdates`, без повторов, порядок появления), `send_message(chat_id: str, text: str) -> None` (`parse_mode="HTML"`, `disable_web_page_preview=True`).
    Любой сетевой сбой или `{"ok": false}` → `TelegramError` (для 401 — «Токен не подошёл»; иначе `description` от Telegram).

- [ ] **Step 1: Тесты** с `httpx.MockTransport`:
  - `test_get_me_returns_username` — ответ `{"ok": true, "result": {"username": "espada_bot"}}` → `"espada_bot"`; запрос на `/bot<token>/getMe`.
  - `test_bad_token_raises` — 401 `{"ok": false, "description": "Unauthorized"}` → `TelegramError("Токен не подошёл")`.
  - `test_find_groups_dedups_and_skips_private` — в `getUpdates` два сообщения из одной supergroup, одно из private, `my_chat_member` из group → две группы `[{"id": "-100123", "title": "Отдел продаж"}, {"id": "-42", "title": "Тест"}]`.
  - `test_send_message_posts_html` — тело запроса `{"chat_id": "-100123", "text": "x", "parse_mode": "HTML", "disable_web_page_preview": true}`.
  - `test_network_error_raises` — `httpx.ConnectError` → `TelegramError`.
- [ ] **Step 2: Run** `pytest tests/test_telegram_client.py -q`. Expected: FAIL (нет модуля).
- [ ] **Step 3: Реализовать** модели, миграцию (`add_column` users + две таблицы, downgrade — обратное), клиент по Interfaces. Базовый URL `https://api.telegram.org`.
- [ ] **Step 4: Run** `pytest tests/test_telegram_client.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(telegram): settings models and bot API client`.

### Task 2: Тексты и отправка по расписанию

**Files:**
- Create: `backend/app/services/telegram/meeting_reminders.py`
- Modify: `backend/app/main.py` (`lifespan`: запуск цикла всегда, отмена при выходе — как `poller`)
- Test: `backend/tests/test_telegram_reminders.py`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `DIGEST_HOUR = 10`, `REMIND_BEFORE = timedelta(minutes=90)`.
  - `mention(user: User | None) -> str` — `@nick`, если ник есть; иначе экранированное имя; `None` → «не назначен».
  - `digest_text(meetings: list[Meeting], day: date) -> str` и `reminder_text(meeting: Meeting) -> str` — формат из спеки (эмодзи, строки, «клоузер …», «сеттер …» — сеттер именем без упоминания, адрес только если не пустой; ссылка `{settings.FRONTEND_URL}/leads/{lead_id}`, без лида — `/sales/meetings`, тегом `<a href>`). Всё пользовательское — через `html.escape`.
  - `run_due(db: Session, client_factory: Callable[[str], TelegramClient], now: datetime) -> None` — один тик:
    1. нет строки настроек, `enabled` False, пустой токен или `chat_id` → выход;
    2. сводка: местное время ≥ 10:00, ключ `digest:<YYYY-MM-DD>` не отправлен, есть запланированные встречи этого местного дня (00:00–24:00 Бишкека) → отправить, по времени встречи;
    3. напоминания: запланированные встречи с `meeting_date - 90 мин <= now < meeting_date`, ключ `meeting:<id>:<meeting_date UTC ISO>` не отправлен → отправить каждую;
    4. отправка = вставить `TelegramSent(key)` и закоммитить (уникальность защищает от второго процесса — `IntegrityError` → откат, пропустить), затем `send_message`; при `TelegramError` — удалить отметку, записать `last_error`/`last_error_at`, перейти к следующей; после успешной отправки — очистить `last_error`.
  - `async telegram_forever(session_factory) -> None` — каждые 60 с вызывает `run_due` в `asyncio.to_thread` с `TelegramClient` и `now=datetime.now(timezone.utc)`; любое исключение логирует и продолжает.

- [ ] **Step 1: Тесты** (фейковый клиент пишет `(chat_id, text)` в список; настройки `enabled=True, bot_token="t", chat_id="-1"`; `now` фиксированный):
  - `test_digest_sent_once_after_ten` — в 09:59 местного ничего; в 10:00 одно сообщение с «Встречи на сегодня, 26.11 — 2» и обеими встречами по порядку; повторный тик — ничего нового.
  - `test_digest_late_start_and_empty_day` — `now` 12:00 → сводка уходит; день без встреч → ничего.
  - `test_digest_skips_other_days_and_statuses` — встреча завтра 00:30 местного и отменённая сегодня в сводку не попадают.
  - `test_reminder_window` — встреча в 11:00: в 09:29 нет, в 09:30 одно «Через 1,5 часа встреча — 11:00», в 09:31 ничего; встреча, назначенная на 10:20 при `now` 10:00, — сразу; встреча, уже начавшаяся, — нет.
  - `test_rescheduled_meeting_reminded_again` — после напоминания `meeting_date` сдвинули на +3 ч → в новом окне ещё одно напоминание.
  - `test_mentions_and_escaping` — клоузер с ником `adahan` → `@adahan`; клоузер без ника → имя; клиент `ООО <Нур> & Co` → `ООО &lt;Нур&gt; &amp; Co`; ссылка на `/leads/{id}`.
  - `test_send_failure_records_error_and_retries` — клиент бросает `TelegramError("Бот не в группе")` → `last_error == "Бот не в группе"`, отметок нет; следующий тик с рабочим клиентом отправляет и очищает `last_error`.
  - `test_disabled_or_unconfigured_sends_nothing` — `enabled=False`; пустой `chat_id`.
- [ ] **Step 2: Run** `pytest tests/test_telegram_reminders.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать** по Interfaces; подключить `telegram_forever(SessionLocal)` в `lifespan`.
- [ ] **Step 4: Run** `pytest tests/test_telegram_reminders.py tests/test_telegram_client.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(telegram): morning digest and 90-minute meeting reminders`.

### Task 3: Эндпоинты настроек

**Files:**
- Create: `backend/app/routers/telegram_settings.py` (prefix `/api/sales-hub/telegram`), подключить в `backend/app/main.py`
- Test: `backend/tests/test_telegram_settings_api.py`

**Interfaces:**
- Consumes: Task 1 (`TelegramClient`, модели), Task 2 (`reminder_text` не нужен; тестовое сообщение — свой текст «✅ Тест: напоминания о встречах будут приходить сюда»).
- Produces (все — только `is_sales_head`, иначе 403; клиент создаётся через зависимость `get_telegram_client_factory()`, которую тесты подменяют):
  - `GET ""` → `{"enabled", "token_tail", "bot_username", "chat_id", "chat_title", "last_error", "last_error_at", "closers": [{"id", "name", "telegram_username"}]}` — `closers`: активные пользователи с `is_closer`, по имени.
  - `PUT "/token"` `{"token": str}` → `get_me`; ошибка → 422 с текстом `TelegramError`; успех — сохранить токен и `bot_username`; если токен сменился — сбросить `chat_id`/`chat_title`. Ответ — как `GET`.
  - `POST "/groups"` → `find_groups()`; без токена → 422 «Сначала сохраните токен бота».
  - `PUT ""` `{"enabled"?: bool, "chat_id"?: str, "chat_title"?: str}` → частичное обновление; `enabled=True` без токена или группы → 422 «Сначала подключите бота и выберите группу».
  - `POST "/test"` → `send_message` в выбранную группу; ошибка → 422 с текстом.
  - `PUT "/closers/{user_id}"` `{"telegram_username": str}` → убрать `@` и пробелы; пусто — допустимо; иначе `^[A-Za-z0-9_]{5,32}$`, не подходит → 422 «Ник Telegram: 5–32 латинских букв, цифр или _»; пользователь не клоузер → 404.

- [ ] **Step 1: Тесты:**
  - `test_staff_forbidden` — сеттер получает 403 на `GET`.
  - `test_save_token_validates_and_masks` — `PUT /token` с `123:ABCDEFGH` → 200, `token_tail == "EFGH"`, `bot_username` от фейка, в JSON нигде нет полного токена; плохой токен → 422 «Токен не подошёл».
  - `test_new_bot_resets_group` — группа выбрана, `PUT /token` с другим токеном → `chat_id == ""`; тот же токен — группа остаётся.
  - `test_find_groups_and_select` — `POST /groups` возвращает список фейка; `PUT ""` с `chat_id`/`chat_title` сохраняет.
  - `test_enable_requires_setup` — `PUT {"enabled": true}` без группы → 422.
  - `test_send_test_message` — фейк получает сообщение в `chat_id`; ошибка фейка → 422 с её текстом.
  - `test_closer_username_normalized` — `" @Adahan_1 "` → `"Adahan_1"`; `"ab"` → 422; не-клоузер → 404.
- [ ] **Step 2: Run** `pytest tests/test_telegram_settings_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Run** `pytest tests/test_telegram_settings_api.py tests/test_telegram_reminders.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(telegram): sales head settings endpoints`.

### Task 4: Окно «Напоминания в Telegram»

**Files:**
- Create: `frontend/src/components/sales/TelegramSettingsModal.tsx`, `frontend/src/lib/telegramSettings.ts`, `frontend/src/lib/telegramSettings.test.ts`
- Modify: `frontend/src/lib/api.ts` (`telegramApi`), `frontend/src/lib/types.ts` (`TelegramSettings`, `TelegramGroup`), `frontend/src/app/sales/meetings/page.tsx` (кнопка)

**Interfaces:**
- Consumes: эндпоинты Task 3.
- Produces: `telegramApi = { get, saveToken(token), findGroups(), update(patch), sendTest(), saveCloser(userId, username) }`; `normalizeUsername(s: string): string` (убрать `@`, пробелы); `<TelegramSettingsModal open onClose />`.

- [ ] **Step 1: Тесты** `telegramSettings.test.ts`: `normalizeUsername(" @adahan ") === "adahan"`, `normalizeUsername("") === ""`.
- [ ] **Step 2: Run** `npm test -- telegramSettings`. Expected: FAIL.
- [ ] **Step 3: Реализовать** окно по спеке: выключатель вверху; блок «1. Бот» (поле токена с плейсхолдером `•••• <token_tail>`, «Сохранить», строка «✓ Бот @… подключён»); «2. Группа» (подсказка, «Найти группы» → радиосписок, выбор сохраняется сразу через `update`, «Отправить тест»); «3. Клоузеры» (строка на клоузера, поле ника, сохранение по blur/Enter); при непустом `last_error` — красная строка «Последняя отправка не удалась: … (дата)». Ошибки — `useToast` с текстом сервера. Кнопка «Напоминания в Telegram» (иконка `send`) в шапке `/sales/meetings` только при `isSalesHead(user)`.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): Telegram reminders settings window`.
- [ ] **Step 6 (контролёр):** `npm run build` при остановленном dev-сервере; в браузере — окно видно руководителю, не видно сеттеру; сохранение ника; ошибки токена показываются текстом. Живую отправку в Telegram — только с токеном и группой владельца.

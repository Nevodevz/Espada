# Карточка клиента и задачи по лидам · План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Карточка лида в раскладке AmoCRM (поля слева, лента и задачи справа) и задачи по лидам с недозвонами, напоминаниями и страницей «Мои задачи».

**Architecture:** Новая таблица `lead_tasks` и сервис `services/lead_tasks.py` (создание, завершение, перенос, автоотмена, серия недозвонов батчем). Лента собирается на сервере (`services/lead_feed.py`) из существующих источников с курсором. Карточка на фронтенде разбивается на компоненты `components/leadcard/*`, старые блоки истории и отдельный чат уходят.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, pytest (SQLite), Next.js 14, vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-lead-card-and-tasks-design.md`

## Global Constraints

- Ветка `dev`; в коммитах не упоминать Claude. Миграция `026`, `down_revision = "025"`.
- Время вводится по Бишкеку (UTC+6, фиксированный сдвиг), хранится в UTC.
- Быстрые сроки:
  - «через 15 мин» = сейчас + 15 мин;
  - «через 1 час» = сейчас + 60 мин;
  - «сегодня вечером» = сегодня 18:00 по Бишкеку (чип скрыт, если уже 18:00 или позже);
  - «завтра утром» = завтра 10:00 по Бишкеку;
  - после недозвона предлагается «Перезвонить» = сейчас + 2 часа.
- Серия недозвонов ≥ 5 → `suggest_lost = true`. Причина отказа ровно «Не выходит на связь».
- Права: ставить, назначать, видеть кнопки — `can_use_whatsapp(db, user)`. Завершать, переносить, отменять — ответственный, автор, admin, основатели. Задачу без ответственного — любой с `can_use_whatsapp`.
- Переписку WhatsApp в ленте видят только пользователи с `can_use_whatsapp`; непрочитанные обнуляет только их запрос.
- Ни одна текущая функция карточки не пропадает: переходы этапов, «Провести оплату», финансы и график оплат, встречи, файлы, касания, проект, архив, редактирование, WhatsApp.

## Review Focus

1. Задача, просроченная на неделю, видна сразу везде — в карточке (красная), на доске (красный ⏰), в «Моих задачах» («Просрочено»), в колокольчике (тест в Task 4).
2. Лид, переведённый в «Минус» или в архив (в т. ч. «Не лид» из WhatsApp), не оставляет висящих задач в «Моих задачах» и колокольчике (тест в Task 2).
3. Клиент сам написал в WhatsApp после трёх недозвонов — серия обнуляется, «Минус» не предлагается (тест в Task 1).
4. Сотрудник без доступа к WhatsApp открывает карточку — в ленте нет сообщений переписки, непрочитанные не сбрасываются (тест в Task 3).
5. Лента лида с 300 событиями грузится порциями по 50, без пропусков и дублей между порциями при совпадающем времени (тест в Task 3).

---

## File Structure

```
backend/app/services/lead_tasks.py        CRUD-логика задач, автоотмена, серия недозвонов, next_task батчем
backend/app/services/lead_feed.py         сборка ленты с курсором
backend/app/services/reminders.py         due_reminders(db, user) — колокольчик (и позже Telegram)
backend/app/routers/lead_tasks.py         /api/leads/{id}/tasks, /api/lead-tasks/*
backend/migrations/versions/026_lead_tasks.py
frontend/src/lib/leadTasks.ts (+test)     quickDue, groupMyTasks, taskLabel, isOverdue
frontend/src/components/leadcard/LeadHeader.tsx
frontend/src/components/leadcard/LeadFields.tsx      левая колонка + свёрнутые блоки
frontend/src/components/leadcard/LeadTasksPanel.tsx  открытые задачи + кнопки результата + предложения
frontend/src/components/leadcard/LeadFeed.tsx        лента с подгрузкой вверх
frontend/src/components/leadcard/LeadComposer.tsx    вкладки WhatsApp / Примечание / Задача
frontend/src/app/tasks/page.tsx                      «Мои задачи»
```

---

### Task 1: Модель задач, сервис и миграция 026

**Files:**
- Modify: `backend/app/models/__init__.py` (класс `LeadTask`)
- Create: `backend/app/services/lead_tasks.py`, `backend/migrations/versions/026_lead_tasks.py`
- Modify: `backend/app/seed.py` (причина «Не выходит на связь» в `_fill(RejectReason, …)`)
- Test: `backend/tests/test_lead_tasks_service.py`

**Interfaces:**
- Produces:
  - `LeadTask` (`lead_tasks`) — поля и значения ровно по спеку §5.1. `kind ∈ {call, message, meeting, other}`, `status ∈ {open, done, canceled}`, `result ∈ {connected, no_answer, rescheduled, done, auto_canceled} | None`.
  - `NO_ANSWER_LOST_THRESHOLD = 5`.
  - `create_task(db, lead: Lead, *, kind: str, due_at: datetime, assignee_id: int | None, created_by: int | None, comment: str = "") -> LeadTask`.
  - `complete_task(db, task: LeadTask, *, result: str, note: str, user_id: int) -> LeadTask` — `result ∈ {connected, no_answer, done}`. Пишет `LeadActivity`: `activity_type` = `"call_result"` для `call`, иначе `"task_done"`, а `description` — человекочитаемая строка вида «📵 Недозвон» / «✅ Дозвонился: <note>» / «✔ Выполнено: <comment>».
  - `reschedule_task(db, task, *, due_at: datetime, user_id: int) -> LeadTask` — закрывает с `rescheduled` и возвращает **новую** задачу.
  - `cancel_open_tasks(db, lead_id: int) -> int` — `status=canceled`, `result=auto_canceled`.
  - `no_answer_streaks(db, lead_ids: list[int]) -> dict[int, int]` — правило спека §5.1: `call` + `no_answer` после позднейшего из «последний `connected`» и «последнее входящее сообщение WhatsApp чата лида».
  - `next_tasks(db, lead_ids: list[int]) -> dict[int, LeadTask]` — ближайшая открытая задача по `due_at`.
- Миграция `026`:
  - создаёт таблицу и индексы `(lead_id, status)`, `(assignee_id, status, due_at)`;
  - добавляет причину «Не выходит на связь», если её нет;
  - переносит `next_action` по правилам спека §5.1 «Детали»: только открытые лиды; без даты — дописать «Было запланировано: <type>» в `comment`; прошлое → день миграции 10:00 Бишкек + «перенесено из «следующего действия» от дд.мм»; `kind = call`, если в `next_action_type` есть «звон», иначе `other`; ответственный — `setter_id`, иначе `closer_id`, иначе `NULL`.

  Downgrade удаляет таблицу (причину и комментарии не трогает).

- [ ] **Step 1: Write the failing tests** `test_lead_tasks_service.py`:
  - `test_create_and_next_task` — две открытые задачи → `next_tasks` отдаёт более раннюю.
  - `test_complete_no_answer_writes_activity_and_streak` — три `no_answer` → серия 3, в `LeadActivity` три `call_result` с «Недозвон».
  - `test_connected_resets_streak` — `no_answer` ×2, `connected`, `no_answer` → 1.
  - `test_inbound_whatsapp_resets_streak` — три `no_answer`, затем входящее `WhatsAppMessage(direction="in")` в чате лида с `sent_at` позже → 0.
  - `test_streak_counts_only_calls` — `kind=message` с `no_answer` не считается.
  - `test_reschedule_creates_new_open_task` — старая `done/rescheduled`, новая `open` с новым `due_at` и тем же `kind`/`comment`/`assignee`.
  - `test_cancel_open_tasks` — открытые → `canceled/auto_canceled`, завершённые не трогаются, возвращается их число.
  - `test_seed_has_unreachable_reason` — `seed_lookups()` (как в `test_stage_kind.py`) создаёт «Не выходит на связь».
- [ ] **Step 2: Run** `cd backend && .venv/Scripts/python -m pytest tests/test_lead_tasks_service.py -q`. Expected: FAIL (ImportError).
- [ ] **Step 3: Implement** the model, service and seed reason.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Migration 026 + PG verify.** Использовать `docker-compose.whatsapp-dev.yml` (`db` на 55432). Перед `upgrade 026` вставить 4 лида:
  - открытый с будущей датой;
  - открытый с прошлой датой;
  - открытый без даты;
  - в «Минус» с датой.

  Ожидается: 2 задачи (будущая — как есть, прошлая — сегодня 10:00 Бишкек), у лида без даты текст в `comment`, у «Минуса» задачи нет; причина в справочнике есть. Затем `downgrade 025` и `upgrade 026` без ошибок.
- [ ] **Step 6: Run the full backend suite.** Expected: green.
- [ ] **Step 7: Commit** `feat(tasks): lead task model, service and migration 026`

---

### Task 2: API задач, права и автоотмена

**Files:**
- Create: `backend/app/routers/lead_tasks.py`
- Modify:
  - `backend/app/main.py` (router);
  - `backend/app/services/leads.py` (`change_lead_stage`: при переходе в `won`/`lost` → `cancel_open_tasks`);
  - `backend/app/routers/leads.py` (`archive_lead` → `cancel_open_tasks`);
  - `backend/app/routers/whatsapp.py` (`ignore_chat`, ветка архивации → `cancel_open_tasks`).
- Test: `backend/tests/test_lead_tasks_api.py`

**Interfaces:**
- Consumes: Task 1, `can_use_whatsapp`.
- Produces (схемы в роутере):
  - `LeadTaskOut {id, lead_id, lead_name, kind, due_at, assignee: UserOut | None, created_by_id, comment, status, result, result_note, completed_at, overdue: bool, can_edit: bool}`;
  - `CompleteOut {task: LeadTaskOut, no_answer_streak: int, suggest_lost: bool}`;
  - эндпоинты — ровно таблица спека §5.4.
    - `GET /api/lead-tasks` принимает `assignee=me|<id>|none` и `scope=overdue|today|upcoming|all` (границы «сегодня» по Бишкеку).
    - Для не-admin `assignee` принудительно `me`.
    - `none` — только для admin и основателей.
  - Валидация:
    - `due_at` обязателен;
    - `kind` из набора;
    - ответственный должен проходить `can_use_whatsapp`, иначе 422;
    - на закрытую задачу `complete`/`reschedule`/`cancel` → 409.

- [ ] **Step 1: Write the failing tests:**
  - `test_create_requires_sales_access` — промптер → 403, сеттер из отдела «Продажи» → 201.
  - `test_assignee_must_have_access` — назначить промптера → 422.
  - `test_complete_by_other_staff_forbidden` — чужой сотрудник → 403; ответственный → 200.
  - `test_complete_returns_streak_and_suggest_lost` — пятый `no_answer` → `suggest_lost=true`, `no_answer_streak=5`.
  - `test_reschedule_endpoint_returns_new_task`.
  - `test_closed_task_conflict` — повторный `complete` → 409.
  - `test_my_tasks_scopes` — задачи вчера/сегодня/завтра раскладываются по `overdue`/`today`/`upcoming`; staff с `assignee=<чужой id>` получает только свои.
  - `test_unassigned_visible_to_admin_only`.
  - `test_lost_stage_cancels_open_tasks` — переход в «Минус» через `PATCH /api/leads/{id}/stage` → задачи `auto_canceled`, в «Моих задачах» пусто.
  - `test_archive_cancels_open_tasks`.
  - `test_whatsapp_ignore_cancels_tasks_of_auto_lead`.
- [ ] **Step 2: Run** `.venv/Scripts/python -m pytest tests/test_lead_tasks_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the full suite. Expected: green.
- [ ] **Step 5: Commit** `feat(tasks): lead tasks API, permissions, auto-cancel on close/archive`

---

### Task 3: Лента событий

**Files:**
- Create: `backend/app/services/lead_feed.py`
- Modify: `backend/app/routers/leads.py` (`GET /api/leads/{lead_id}/feed`; `create_activity` принимает `activity_type="note"`)
- Test: `backend/tests/test_lead_feed.py`

**Interfaces:**
- Consumes: Task 1, `lead_chat` из `routers/whatsapp.py`, `can_use_whatsapp`.
- Produces:
  - `FeedItem {key: str, type: str, at: datetime, actor: UserOut | None, data: dict}`.
    - `type ∈ {created, stage, activity, note, message, meeting, task_created, task_done, file, payment}`.
    - `key` уникален (`"<type>:<id>"`).
  - `build_feed(db, lead: Lead, *, include_messages: bool, before: str | None, limit: int) -> tuple[list[FeedItem], str | None]`.
    - Сортировка по `(at, key)` убывающе.
    - Курсор — непрозрачная строка из последней пары `(at, key)`.
    - Второй элемент — курсор следующей порции или `None`.
    - Записи `LeadActivity` с `activity_type="stage_change"` не выводятся.
    - `task_done` берётся из задач (а не из `call_result`-активностей): активности `call_result`/`task_done` в ленту не дублируются.
  - `GET /api/leads/{id}/feed?before=&limit=50` (limit ≤ 100) → `{items: FeedItem[], next_before: str | None}`.
    - `include_messages = can_use_whatsapp(db, user)`.
    - При `include_messages` и первой порции (`before` пуст) обнуляется `unread_count` чата.

- [ ] **Step 1: Write the failing tests:**
  - `test_feed_merges_sources_in_order` — созданный лид, смена этапа, примечание, входящее и исходящее WhatsApp, встреча, задача создана и завершена, файл, подтверждённая оплата. Все типы присутствуют, порядок по времени убывающий.
  - `test_feed_hides_messages_without_access` — промптер: нет `message`, `unread_count` чата не изменился. Сеттер отдела «Продажи»: есть, `unread_count == 0`.
  - `test_feed_pagination_no_gaps_or_duplicates` — 300 событий, 120 из них с одинаковым `at`. Проход порциями по 50 даёт ровно 300 уникальных `key`.
  - `test_stage_change_activity_not_duplicated`.
  - `test_note_created_via_activities_endpoint` — `POST /api/leads/{id}/activities {activity_type:"note", description:"…"}` → в ленте `note`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (курсор: base64 от `"<iso at>|<key>"`; каждый источник выбирает `limit+1` строк не позже курсора, слияние в Python, обрезка до `limit`).
- [ ] **Step 4: Run** the file and the full suite. Expected: green.
- [ ] **Step 5: Commit** `feat(leads): unified lead feed with cursor pagination`

---

### Task 4: Доска, список, колокольчик, аналитика

**Files:**
- Create: `backend/app/services/reminders.py`
- Modify:
  - `backend/app/services/lead_board.py`, `backend/app/routers/lead_board.py`;
  - `backend/app/routers/leads.py` (`LeadOut.next_task`, `LeadOut.no_answer_streak` для списка, батчем);
  - `backend/app/routers/notifications.py` (пункты 6 и 7 → задачи через `due_reminders`);
  - `backend/app/services/analytics.py:410-435`.
- Test: `backend/tests/test_lead_tasks_board_bell.py`

**Interfaces:**
- Consumes: Task 1 (`next_tasks`, `no_answer_streaks`).
- Produces:
  - `NextTaskOut {id, kind, due_at, overdue, assignee_id}` в `LeadOut` (по умолчанию `None`) и `no_answer_streak: int = 0`. Заполняются в `/api/leads` и `/api/lead-board`, без N+1.
  - `board_sort_key(lead, unread=0, next_task=None, now=None) -> tuple` — порядок: непрочитанные → просрочено → нет задачи → по активности.
  - `GET /api/lead-board` — новые флаги `overdue: bool`, `no_task: bool`.
  - `due_reminders(db, user, now=None) -> list[dict]` — элементы в формате `_notif`:
    - `task_soon_<id>` «Через 15 минут: <тип> — <клиент>» (срок в ближайшие 15 мин);
    - `task_overdue_<id>` «Просрочено: <тип> — <клиент>» (до 15 штук);
    - `leads_no_task` «Лиды без задачи: N» (открытые лиды пользователя-сеттера или клоузера без открытой задачи; для admin — все), ссылка `/leads/board?no_task=true`.
  - Аналитика: «без следующего действия» → открытые лиды без открытой задачи; «просрочено» → лиды с просроченной открытой задачей.

- [ ] **Step 1: Write the failing tests:**
  - `test_week_overdue_task_visible_everywhere` — задача неделю назад: в `/api/lead-board` у карточки `next_task.overdue == true`; в `/api/lead-tasks?scope=overdue` есть; в колокольчике ответственного есть `task_overdue_<id>`.
  - `test_soon_reminder_window` — срок через 10 мин → `task_soon`, через 30 мин → нет.
  - `test_board_sort_overdue_before_no_task_before_rest`.
  - `test_board_filters_overdue_and_no_task`.
  - `test_list_has_next_task_and_streak`.
  - `test_old_next_action_notifications_gone` — у лида с прошлым `next_action_at` нет `lead_action_overdue_*`.
  - `test_analytics_counts_from_tasks` (через существующую функцию проблем в `services/analytics.py`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the full suite. Expected: green.
- [ ] **Step 5: Commit** `feat(tasks): tasks on board, list, bell and analytics`

---

### Task 5: Клиентские хелперы и API

**Files:**
- Create: `frontend/src/lib/leadTasks.ts`, `frontend/src/lib/leadTasks.test.ts`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`

**Interfaces:**
- Consumes: эндпоинты Tasks 2–4.
- Produces:
  - Типы `LeadTask`, `LeadTaskKind`, `LeadTaskResult`, `CompleteResult`, `FeedItem`, `FeedPage`, `NextTask`; `Lead.next_task: NextTask | null`, `Lead.no_answer_streak: number`.
  - `leadTasksApi {list(leadId, status), create(leadId, body), complete(id, result, note), reschedule(id, dueAt), cancel(id), mine(scope, assignee?)}`; `leadApi.feed(leadId, before?)`; `leadApi.addNote(leadId, text)`.
  - `quickDue(choice: "15m" | "1h" | "evening" | "tomorrow" | "callback", now: Date): Date | null` — значения из Global Constraints; `"evening"` после 18:00 по Бишкеку → `null`; `"callback"` = +2 часа.
  - `TASK_KIND_LABELS: Record<LeadTaskKind, string>` = Позвонить / Написать / Встреча / Другое.
  - `isOverdue(task, now): boolean`.
  - `groupMyTasks(tasks, now): {overdue, today, later}` — по Бишкеку.

- [ ] **Step 1: Write the failing tests:**
  - `quickDue`:
    - `"evening"` в 12:00 по Бишкеку → 18:00 того же дня (UTC 12:00);
    - в 19:00 → `null`;
    - `"tomorrow"` в 23:30 по Бишкеку → 10:00 следующего дня;
    - `"15m"`, `"1h"`, `"callback"`.
  - `groupMyTasks` — граница полуночи по Бишкеку (задача на 23:50 Бишкека — «сегодня», на 00:10 — «позже»).
  - `isOverdue`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/leadTasks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. `npx tsc --noEmit -p .` — без ошибок.
- [ ] **Step 5: Commit** `feat(tasks): client types, API and task time helpers`

---

### Task 6: Новая карточка лида (раскладка A)

**Files:**
- Create: `frontend/src/components/leadcard/{LeadHeader,LeadFields,LeadTasksPanel,LeadFeed,LeadComposer}.tsx`
- Modify: `frontend/src/app/leads/[id]/page.tsx` — страница собирает компоненты. Блоки «Этапы сделки», «Следующее действие», «История касаний», «Таймлайн событий», отдельный блок WhatsApp удаляются; модалки (`EditLeadModal`, `AddActivityModal`, файл, `TransitionModal`, `ConfirmModal`) и `PaymentScheduleSection` переиспользуются.
- Delete: `frontend/src/components/whatsapp/LeadWhatsAppChat.tsx` — его отправка переезжает в `LeadComposer`, отображение сообщений в `LeadFeed`; `ProtectedImage` и `download` выносятся в `components/whatsapp/media.tsx` и переиспользуются.

**Interfaces:**
- Consumes: Task 5; существующие `whatsappApi`, `leadApi`, `stageKind`.
- Раскладка и поведение — ровно спек §5.5:
  - Шапка: имя, телефон, полоса этапов (клик по этапу = тот же поток, что «Перевести»), «Перевести ▾», «Провести оплату» (на `contract`/`waiting_payment`), «⋯» (Изменить, Добавить касание, Загрузить файл, Архив).
  - Левая колонка: Сеттер, Клоузер, Источник, Услуга, Сумма сделки, Оплачено/Остаток, 📵×N. Свёрнутые блоки: «Финансы и график оплат», «Встречи (N)», «Файлы (N)», «Проект в разработке» (если есть).
  - Правая колонка: `LeadTasksPanel` (открытые задачи, просроченные красные; «Дозвонился»/«Недозвон»/«Перенести»/«Выполнено» для не-звонков; после недозвона — строка «📞 Перезвонить · через 2 часа [Поставить] [другое время] [не надо]»; при `suggest_lost` — «5 недозвонов подряд — перевести в «Минус»?» → `TransitionModal` для этапа `lost` с выбранной причиной «Не выходит на связь»; после «Дозвонился» — поле итога и «Следующий шаг: [сменить этап ▾] [поставить задачу]»; жёлтая плашка «Нет следующей задачи — поставьте», если открытых нет и лид открыт) → `LeadFeed` (порции, подгрузка при прокрутке вверх, обновление первой порции каждые 5 с при видимой вкладке, рендер всех типов `FeedItem`, медиа WhatsApp через `ProtectedImage`/скачивание) → `LeadComposer` (вкладки; «WhatsApp» только при `access.can_use`; по умолчанию открыта при `whatsapp_chat_id`, иначе «Задача»; «Задача» с чипами типа и `quickDue`, «дата и время…», ответственный из пользователей с доступом, комментарий).
  - Ширина < 900px: колонки в столбик, правая первой.
  - Кнопки «Взять себе» и «Не лид» остаются (в шапке под «⋯» → «Не лид»; «Взять себе» рядом с сеттером, если его нет).

- [ ] **Step 1: Build the components and page.**
- [ ] **Step 2: Run** `cd frontend && npm test && npx tsc --noEmit -p . && npm run build`. Expected: green.
- [ ] **Step 3: Manual check** (локальный стенд, лид «Бектур»):
  - видны поля, задачи, лента (переписка, фото, этапы), композер;
  - поставить «Позвонить через 15 мин» → задача сверху;
  - «Недозвон» → запись в ленте и предложение «через 2 часа» → «Поставить» → новая задача, на доске 📵×1;
  - «Дозвонился» с итогом → «Следующий шаг»;
  - примечание → в ленте;
  - «Перевести» → «Встреча» → форма → встреча в ленте;
  - «Провести оплату» на «Договоре»;
  - свёрнутые финансы и файлы открываются;
  - ширина 390px — колонки в столбик без горизонтального скролла.
- [ ] **Step 4: Commit** `feat(leads): AmoCRM-style lead card with feed, tasks and composer`

---

### Task 7: «Мои задачи», меню и доска

**Files:**
- Create: `frontend/src/app/tasks/page.tsx`
- Modify:
  - `frontend/src/components/Shell.tsx` — пункт «Мои задачи» в группе отдела продаж, со счётчиком просроченных;
  - `frontend/src/components/leads/LeadBoard.tsx` — ⏰ время ближайшей задачи (красное при `overdue`), «Нет задачи», 📵×N;
  - `frontend/src/app/leads/board/page.tsx` — быстрые фильтры «Просрочено», «Без задачи»;
  - `frontend/src/components/leads/LeadListView.tsx` — колонка «Следующий шаг» из `next_task`.

**Interfaces:**
- Consumes: Tasks 4–5.
- `/tasks`:
  - группы из `groupMyTasks`;
  - строка: время, тип, клиент-ссылка, комментарий и те же кнопки результата (`LeadTasksPanel` в компактном режиме или общий `TaskActions` из Task 6);
  - для admin и основателей — фильтр «Ответственный» (все / конкретный / без ответственного).

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npm test && npx tsc --noEmit -p . && npm run build`. Expected: green.
- [ ] **Step 3: Manual check:**
  - просроченная задача видна в «Мои задачи» → «Просрочено», на доске красный ⏰, в колокольчике;
  - фильтры доски работают;
  - «Недозвон» со страницы задач обновляет список.
- [ ] **Step 4: Commit** `feat(tasks): my tasks page, board task badges and filters`

---

### Task 8: Документация и MCP

**Files:**
- Modify: `README.md`, `docs/product-spec.md` (§4 карточка и задачи, API, права), `DEPLOY.md` (миграция 026: перенос «следующего действия», что проверить после выкладки)
- Modify при необходимости: `mcp-server/server.py` (если инструменты лидов читают или пишут `next_action_*` — перевести на задачи или убрать поле)

- [ ] **Step 1:** `grep -n next_action mcp-server/server.py` → обновить найденное.
- [ ] **Step 2:** Обновить документацию.
- [ ] **Step 3: Run** `cd mcp-server && python -m pytest -q` (если тесты есть) и полный бэкенд.
- [ ] **Step 4: Commit** `docs: lead card and tasks`

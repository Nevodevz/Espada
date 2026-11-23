# Перестройка модуля «Отдел продаж» · План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Меню продаж «Сегодня · Лиды · Встречи · Показатели», встреча из календаря с выбором лида и свободными окнами клоузера, автоматические показатели вместо ручного Дневника, правка карточки лида на месте.

**Architecture:** Бэкенд: общий помощник прав продаж (`services/sales_access.py`), одна функция «назначить встречу лиду» для перевода этапа и `POST /api/meetings`, новый роутер `/api/sales-hub` (экран «Сегодня» и «Показатели») поверх сервисов `sales_today.py` и `sales_metrics.py`. Фронтенд: три новые страницы `/sales/today|meetings|metrics`, `/leads` с переключателем Доска/Список, компонент правки на месте в карточке; старые адреса редиректят, мёртвый код удаляется последним.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, pytest (SQLite), Next.js 14, vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-sales-module-restructure-design.md`

## Global Constraints

- Ветка `dev`, PR в `dev`. В коммитах и PR не упоминать Claude (без Co-Authored-By).
- Время вводится и «день» считается по Бишкеку (UTC+6, `BISHKEK_TZ` из `services/leads.py`), хранится в UTC.
- Руководитель продаж = `role == admin` или `is_founder` или `position == "Руководитель продаж"`.
- Сотрудник продаж = `can_use_whatsapp(db, user)` (админ, основатель, `is_closer`, член отдела `sales`).
- Клоузер = `User.is_closer` (на фронте `isCloser()` из `lib/roles.ts`).
- Касание = уникальная тройка (сотрудник, лид, день по Бишкеку), где было хотя бы одно из: `LeadActivity` `activity_type == "call_result"` с `responsible_id`; `WhatsAppMessage` `direction == "out"` с `sender_user_id`, чат привязан к лиду (`WhatsAppChat.lead_id`); ручное касание (`LeadActivity` любого типа, кроме `stage_change`, `call_result`, `whatsapp`, с `responsible_id`).
- Назначено встреч = `Meeting.setter_id`, `created_at` в периоде, `parent_id IS NULL`. Проведено = статус `closed|minus|push`, `meeting_date` в периоде. Клоузер «по статусам» — по `meeting_date`, без `rescheduled`.
- Свободные окна клоузера: 10:00–19:00 по Бишкеку, шаг 60 мин; константы `SLOT_DAY_START = 10`, `SLOT_DAY_END = 19`, `SLOT_STEP_MIN = 60` в `frontend/src/lib/meetingSlots.ts`.
- Пикер клиента встречи — только открытые лиды: `status != archived`, этап не `is_won`/`is_lost`.
- Новые адреса: `/sales/today`, `/sales/meetings`, `/sales/metrics`, `/leads?view=board|list`. Редиректы: `/tasks` → `/sales/today`, `/leads/board` → `/leads?view=board` (с сохранением прочих query), `/dept/sales` → `/sales/metrics`, `/dept/sales?meetings=1` → `/sales/meetings`.
- Данные `sales_records` не удаляются; ручной ввод Дневника из интерфейса уходит.
- `/kpi` не меняется. `/analytics` теряет только продажные блоки (§5.4 спеки).
- Тесты: бэкенд `cd backend && .venv/Scripts/python -m pytest -q`; фронт `cd frontend && npm test`; сборка `cd frontend && npm run build`.

## Review Focus

1. Лид уже на «Договоре», встречу ему назначают из календаря → этап не откатывается на «Встречу», встреча привязана (тест в Task 2).
2. Сеттер отправил 10 сообщений одному клиенту и позвонил ему в тот же день → 1 касание; то же самое в 23:30 и 00:30 по Бишкеку → 2 касания (тест в Task 4).
3. Встречу перенесли (дочерняя встреча + `rescheduled`) → «назначено» не удваивается, у клоузера перенос не считается (тест в Task 4).
4. Клиент написал в WhatsApp, менеджер ответил шаблоном → строка уходит из «Клиент написал, мы не ответили»; лид в «Минусе» туда не попадает вовсе (тест в Task 3).
5. Сумма сделки правится на месте ниже суммы графика оплат → сервер отвечает 422, в поле возвращается прежнее значение и показан текст ошибки (тест в Task 10).

---

## File Structure

```
backend/app/services/sales_access.py      NEW  is_sales_head, is_sales_staff
backend/app/services/leads.py             MOD  schedule_meeting_for_lead (выделено из _handle_meeting_stage)
backend/app/routers/meetings.py           MOD  POST с lead_id → общая логика; setter_id в MeetingCreate
backend/app/routers/leads.py              MOD  GET /api/leads?open_only=true
backend/app/routers/lead_tasks.py         MOD  _is_manager → is_sales_head
backend/app/services/sales_today.py       NEW  unclaimed_leads, awaiting_reply
backend/app/services/sales_metrics.py     NEW  totals, employee_rows
backend/app/routers/sales_hub.py          NEW  GET /api/sales-hub/today, /metrics
backend/tests/test_sales_access.py, test_meeting_for_lead.py, test_sales_today.py, test_sales_metrics.py  NEW

frontend/src/lib/roles.ts                 MOD  isSalesHead
frontend/src/lib/meetingSlots.ts          NEW  daySlots (+ .test.ts)
frontend/src/lib/leadsView.ts             NEW  resolveLeadsView (+ .test.ts)
frontend/src/lib/leadPatch.ts             NEW  buildLeadPatch (+ .test.ts)
frontend/src/lib/api.ts, types.ts         MOD  salesHubApi, типы
frontend/src/components/meetings/CloserSlots.tsx, LeadPicker.tsx, MeetingsTable.tsx   NEW
frontend/src/components/meetings/MeetingModal.tsx, ../TransitionModal.tsx             MOD
frontend/src/components/sales/*           NEW  блоки «Сегодня» и «Показателей», DiaryArchive
frontend/src/components/leads/LeadBoardView.tsx  NEW (тело бывшей /leads/board)
frontend/src/components/leadcard/InlineField.tsx NEW
frontend/src/app/sales/{today,meetings,metrics}/page.tsx  NEW
frontend/src/app/leads/page.tsx, leads/[id]/page.tsx, analytics/page.tsx, components/Shell.tsx  MOD
удаляются в Task 11: SalesDepartmentView.tsx, EditLeadModal, тело /tasks и /leads/board
```

---

### Task 1: Права продаж

**Files:**
- Create: `backend/app/services/sales_access.py`, `backend/tests/test_sales_access.py`
- Modify: `backend/app/routers/lead_tasks.py:69-70`, `frontend/src/lib/roles.ts`, `frontend/src/lib/roles.test.ts`

**Interfaces:**
- Produces: `is_sales_head(user: User) -> bool`; `is_sales_staff(db: Session, user: User) -> bool` (= `can_use_whatsapp`); TS `isSalesHead(u: Pick<User,"role"|"is_founder"|"position">): boolean`.

- [ ] **Step 1: Тесты** в `test_sales_access.py`: `test_head_by_position` (staff с `position="Руководитель продаж"` → True), `test_admin_and_founder_are_heads`, `test_setter_is_not_head`; `test_head_of_sales_sees_unassigned_tasks` — `GET /api/lead-tasks?scope=all&assignee=none` от руководителя продаж (не админ) отдаёт задачи без ответственного (как сейчас для админа). В `roles.test.ts`: `isSalesHead` для тех же трёх случаев.
- [ ] **Step 2: Run** `cd backend && .venv/Scripts/python -m pytest tests/test_sales_access.py -q` и `cd frontend && npm test -- roles`. Expected: FAIL.
- [ ] **Step 3: Реализовать** оба модуля; `lead_tasks._is_manager` делегирует в `is_sales_head`.
- [ ] **Step 4: Run** те же команды + `pytest tests/test_lead_tasks_api.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): sales head and staff access helpers`.

### Task 2: Одна логика «назначить встречу лиду»

**Files:**
- Modify: `backend/app/services/leads.py` (`_handle_meeting_stage`), `backend/app/routers/meetings.py` (`MeetingCreate`, `create_meeting`), `backend/app/routers/leads.py` (`list_leads`)
- Create: `backend/tests/test_meeting_for_lead.py`

**Interfaces:**
- Produces:
  - `schedule_meeting_for_lead(db, lead, *, meeting_dt: datetime, closer_id: int | None, setter_id: int | None, address: str = "", notes: str = "", duration_minutes: int | None = None) -> Meeting` — переносит открытую встречу или создаёт новую (поведение нынешнего `_handle_meeting_stage`), заполняет `lead.closer_id`, если пуст. `_handle_meeting_stage` парсит дату/время и вызывает её.
  - `MeetingCreate.setter_id: Optional[int] = None`.
  - `POST /api/meetings` с `lead_id`: 422 «Лид закрыт или в архиве», если лид не открыт; если позиция этапа лида меньше позиции этапа `kind == "meeting"` → `change_lead_stage(db, lead, meeting_stage.id, changed_by=user.id, extra_data=…)`; иначе → `schedule_meeting_for_lead`. Сеттер = `payload.setter_id or lead.setter_id or user.id`. Без `lead_id` — как сейчас.
  - `GET /api/leads?open_only=true` — фильтр открытых лидов (Global Constraints).

- [ ] **Step 1: Тесты** (`lead` фикстура на «Договоре», `stages`):
  - `test_meeting_for_early_lead_moves_stage` — лид на «Созвоне» → после POST этап «Встреча», одна встреча.
  - `test_meeting_for_contract_lead_keeps_stage` — лид на «Договоре» → этап «Договор», встреча с `lead_id`.
  - `test_existing_open_meeting_is_rescheduled` — повторный POST → встреч 1, дата новая.
  - `test_closed_lead_rejected` — лид на «Минусе» и архивный → 422.
  - `test_setter_from_payload_then_lead` — `setter_id` в запросе побеждает, без него — `lead.setter_id`.
  - `test_stage_transition_fills_lead_closer` — у лида `closer_id=None`, перевод во «Встречу» с `closer_id` → `lead.closer_id` заполнен; уже заполненный не перетирается.
  - `test_open_only_filter` — `GET /api/leads?open_only=true` не отдаёт архивный, оплаченный и «Минус».
- [ ] **Step 2: Run** `pytest tests/test_meeting_for_lead.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать** по Interfaces.
- [ ] **Step 4: Run** `pytest tests/test_meeting_for_lead.py tests/test_meeting_stage.py tests/test_stage_transitions.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(meetings): one scheduling path for lead meetings`.

### Task 3: Данные экрана «Сегодня»

**Files:**
- Create: `backend/app/services/sales_today.py`, `backend/app/routers/sales_hub.py`, `backend/tests/test_sales_today.py`
- Modify: `backend/app/main.py` (подключить роутер)

**Interfaces:**
- Consumes: `is_sales_head`, `is_sales_staff` (Task 1).
- Produces:
  - `unclaimed_leads(db, limit=50) -> list[dict]` — `setter_id IS NULL`, открытые, сначала старые; поля `id, client_name, phone, source_name, created_at`.
  - `awaiting_reply(db, user, limit=50) -> list[dict]` — лиды, у чата которых последнее сообщение (`max(sent_at)`) входящее; лид не архив и не `is_lost`; руководитель — все, иначе `setter_id == user.id or closer_id == user.id or setter_id IS NULL`; поля `lead_id, client_name, last_body, last_at`; сортировка по `last_at` возр.
  - `GET /api/sales-hub/today` → `{"unclaimed": [...], "awaiting_reply": [...]}`; 403 для не-сотрудников продаж.

- [ ] **Step 1: Тесты** (фейки чатов — как в `tests/whatsapp_fakes.py`):
  - `test_unclaimed_excludes_taken_and_closed`;
  - `test_awaiting_reply_last_inbound_only` — вход → в списке; вход, затем исходящий шаблон → нет;
  - `test_awaiting_reply_skips_lost_and_unlinked_chats`; `test_won_lead_is_included`;
  - `test_staff_sees_own_and_unassigned_head_sees_all`;
  - `test_today_forbidden_for_non_sales` — 403.
- [ ] **Step 2: Run** `pytest tests/test_sales_today.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** Последнее сообщение — подзапрос `max(sent_at)` по `chat_id`, join с сообщением по `(chat_id, sent_at)`.
- [ ] **Step 4: Run** тот же тест. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): today screen data`.

### Task 4: Данные «Показателей»

**Files:**
- Create: `backend/app/services/sales_metrics.py`, `backend/tests/test_sales_metrics.py`
- Modify: `backend/app/routers/sales_hub.py`

**Interfaces:**
- Produces:
  - `totals(db, date_from: date, date_to: date, source_id=None, service_id=None, user_id=None) -> dict` с ключами `leads, meetings_booked, meetings_held, sales, conversion_pct, deals_amount, paid, remaining` (переносит расчёты `/api/leads/stats` и `funnel-stats` без повторов; `user_id` — сеттер или клоузер лида).
  - `employee_rows(db, date_from, date_to) -> {"setters": [{user_id, name, touches, calls_connected, calls_no_answer, booked, held}], "closers": [{user_id, name, by_status: {scheduled, closed, minus, push, not_held}, sales, sales_amount}]}` — по правилам Global Constraints; строка есть, если хоть одно значение > 0.
  - `GET /api/sales-hub/metrics?date_from&date_to&source_id&service_id&user_id` → `{"totals", "funnel", "daily", "sources", "employees"}`; `funnel/daily/sources` берутся из `analytics.charts_data(db, date_from, date_to)` (только период). Руководитель — все строки; сотрудник продаж — `employees` только со своей строкой; прочие — 403.

- [ ] **Step 1: Тесты:**
  - `test_touch_is_lead_per_day` — 10 исходящих + звонок одному лиду в один день → `touches == 1`;
  - `test_touch_day_boundary_is_bishkek` — действия в 23:30 и 00:30 по Бишкеку → 2;
  - `test_stage_change_is_not_a_touch`; `test_manual_activity_is_a_touch`;
  - `test_calls_connected_and_no_answer` — из `call_result` («✅ Дозвонился» / «📵 Недозвон»);
  - `test_booked_ignores_reschedule_children`; `test_held_by_meeting_date`;
  - `test_closer_status_counts_skip_rescheduled`; `test_closer_sales_from_paid_deals`;
  - `test_staff_sees_only_own_row`; `test_metrics_forbidden_for_non_sales`.
- [ ] **Step 2: Run** `pytest tests/test_sales_metrics.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** Касания: объединить три источника в набор `(user_id, lead_id, bishkek_date)` и посчитать по `user_id` (в Python допустимо — объём за период небольшой).
- [ ] **Step 4: Run** тот же тест. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): automatic sales metrics`.

### Task 5: Свободные окна клоузера

**Files:**
- Create: `frontend/src/lib/meetingSlots.ts`, `frontend/src/lib/meetingSlots.test.ts`, `frontend/src/components/meetings/CloserSlots.tsx`
- Modify: `frontend/src/components/TransitionModal.tsx` (блок встречи)

**Interfaces:**
- Produces: `daySlots(meetings: Pick<Meeting,"meeting_date"|"duration_minutes"|"client_name"|"status">[], day: string /* YYYY-MM-DD Бишкек */): {time: string /* HH:mm */, busyBy: string | null}[]`; `<CloserSlots closerId day value onPick(time) />` — грузит `meetingApi.list({closer_id, date_from: day, date_to: day})`, серые занятые с именем, кликабельные свободные.

- [ ] **Step 1: Тесты** `daySlots`: пустой день → 9 слотов 10:00…18:00 свободны; встреча 12:00 на 90 мин занимает 12:00 и 13:00; встречи со статусом `rescheduled`/`not_held` не занимают; встреча другого дня не влияет.
- [ ] **Step 2: Run** `cd frontend && npm test -- meetingSlots`. Expected: FAIL.
- [ ] **Step 3: Реализовать** `daySlots` и `CloserSlots`; в `TransitionModal` показать `CloserSlots` под полями даты/клоузера, клик подставляет время.
- [ ] **Step 4: Run** `npm test -- meetingSlots`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(meetings): closer free slots`.

### Task 6: Новая встреча с выбором лида

**Files:**
- Create: `frontend/src/components/meetings/LeadPicker.tsx`, `frontend/src/lib/meetingForm.ts`, `frontend/src/lib/meetingForm.test.ts`
- Modify: `frontend/src/components/meetings/MeetingModal.tsx`, `frontend/src/lib/api.ts` (`LeadQuery.open_only`, `meetingApi.create` принимает `setter_id`)

**Interfaces:**
- Consumes: `POST /api/meetings` с `lead_id`, `setter_id`; `GET /api/leads?open_only=true&search=` (Task 2); `CloserSlots` (Task 5).
- Produces: `meetingFormFromLead(lead: Pick<Lead,"id"|"client_name"|"phone"|"setter_id">) -> {lead_id, client_name, client_phone, setter_id}`; `<LeadPicker value onPick(lead) onCreateNew(text) />` — поиск с задержкой 300 мс, строки «имя · телефон · этап · сеттер», последний пункт «+ Новый клиент «…»».

- [ ] **Step 1: Тесты** `meetingFormFromLead`: телефон и сеттер копируются; пустой телефон → `""`; `setter_id = null` остаётся `null`.
- [ ] **Step 2: Run** `npm test -- meetingForm`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** В `MeetingModal` поле «Клиент» → `LeadPicker`; после выбора телефон и сеттер (выпадающий, можно сменить) заполнены; «+ Новый клиент» вызывает `leadApi.create({client_name|phone из текста, setter_id: me})`, затем встречу с его `id`. Если у выбранного лида есть открытая встреча (`lead.scheduled_meeting` / ответ бэка) — предупреждение «встреча будет перенесена», как в `TransitionModal`. `CloserSlots` под клоузером/датой.
- [ ] **Step 4: Run** `npm test` и `npm run build`. Expected: PASS, сборка без ошибок.
- [ ] **Step 5: Commit** `feat(meetings): pick client from leads`.

### Task 7: Страница «Встречи»

**Files:**
- Create: `frontend/src/app/sales/meetings/page.tsx`, `frontend/src/components/meetings/MeetingsTable.tsx`
- Modify: `frontend/src/components/meetings/SalesMeetingsCalendar.tsx` (проп `defaultCloserId`)

**Interfaces:**
- Produces: `<MeetingsTable />` — бывшая модалка-таблица из `SalesDepartmentView` (период, роль, статус, карточки статусов, колонки Дата/Клиент/Телефон/Сеттер/Клоузер/Статус/Адрес) как обычный блок страницы.

- [ ] **Step 1:** Перенести таблицу из `SalesDepartmentView` в `MeetingsTable` без изменения поведения.
- [ ] **Step 2:** Страница: заголовок, переключатель «Календарь / Таблица» (`?view=calendar|table`), календарь на всю ширину; `defaultCloserId = isCloser(me) ? me.id : undefined`.
- [ ] **Step 3: Run** `npm run build`; открыть `/sales/meetings` в превью, создать встречу кликом по слоту с выбором лида, переключить на таблицу. Expected: встреча видна в обоих видах и в карточке лида.
- [ ] **Step 4: Commit** `feat(sales): meetings page`.

### Task 8: Страница «Сегодня»

**Files:**
- Create: `frontend/src/app/sales/today/page.tsx`, `frontend/src/components/sales/MyTasksBlock.tsx`, `UnclaimedLeadsBlock.tsx`, `AwaitingReplyBlock.tsx`, `frontend/src/lib/waiting.ts`, `waiting.test.ts`
- Modify: `frontend/src/lib/api.ts` (`salesHubApi.today()`), `frontend/src/lib/types.ts`

**Interfaces:**
- Consumes: `GET /api/sales-hub/today` (Task 3).
- Produces: `formatWaiting(fromIso: string, now: Date): string` — «4 мин», «1 ч 10 мин», «2 дн»; `MyTasksBlock` — тело нынешней `app/tasks/page.tsx` (группы, выбор сотрудника для `isSalesHead`).

- [ ] **Step 1: Тесты** `formatWaiting`: 4 мин, 70 мин → «1 ч 10 мин», 49 ч → «2 дн», будущее время → «0 мин».
- [ ] **Step 2: Run** `npm test -- waiting`. Expected: FAIL.
- [ ] **Step 3: Реализовать** страницу: слева «Мои задачи», справа «Новые лиды, никто не взял» (кнопка «Взять» → `whatsappApi.take`) и «Клиент написал, мы не ответили»; опрос раз в 60 с; клик по строке → `/leads/{id}`.
- [ ] **Step 4: Run** `npm test` и `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): today page`.

### Task 9: «Лиды» — Доска/Список на одной странице

**Files:**
- Create: `frontend/src/components/leads/LeadBoardView.tsx`, `frontend/src/lib/leadsView.ts`, `leadsView.test.ts`
- Modify: `frontend/src/app/leads/page.tsx`, `frontend/src/components/leads/LeadListView.tsx` (принимать тумблеры), `backend/app/routers/leads.py` (`list_leads`: `mine`, `unassigned`, `overdue`, `no_task` — если их ещё нет у списка; логику брать из `services/lead_board.py`)

**Interfaces:**
- Produces: `resolveLeadsView(param: string | null, stored: string | null): "board" | "list"` — параметр адреса важнее сохранённого, по умолчанию `"board"`; ключ хранения `leads.view`.

- [ ] **Step 1: Тесты** `resolveLeadsView`: `("list", "board") → "list"`, `(null, "list") → "list"`, `(null, null) → "board"`, `("мусор", null) → "board"`. Бэкенд: `test_list_toggles_match_board` в `tests/test_lead_board.py` — одинаковый набор id у доски и списка для `overdue=true` и `no_task=true`.
- [ ] **Step 2: Run** `npm test -- leadsView`, `pytest tests/test_lead_board.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** Тело `app/leads/board/page.tsx` → `LeadBoardView`; `/leads` рендерит общий `LeadFiltersBar` + тумблеры + переключатель и нужный вид; обе строки карточек цифр (`leadApi.stats`, `funnelStats`) убрать; экспорт и «Новый лид» остаются.
- [ ] **Step 4: Run** `npm test`, `pytest -q`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(leads): board and list on one page`.

### Task 10: Карточка лида — правка на месте

**Files:**
- Create: `frontend/src/components/leadcard/InlineField.tsx`, `frontend/src/lib/leadPatch.ts`, `leadPatch.test.ts`
- Modify: `frontend/src/app/leads/[id]/page.tsx`

**Interfaces:**
- Produces:
  - `buildLeadPatch(field: LeadEditableField, raw: string): Record<string, unknown>` — `""` → `null` для необязательных, числа (`deal_amount`, `employees_count`) парсятся, `client_name` не может стать пустым (бросает `Error("Имя обязательно")`), id-поля (`source_id`, `service_id`, `setter_id`, `closer_id`) → `number | null`.
  - `<InlineField label value display kind="text"|"number"|"select"|"textarea" options? onSave(raw) => Promise<void> />` — карандаш по наведению, Enter/blur сохраняет, Esc отменяет, «добавить…» серым для пустого, при ошибке возвращает прежнее значение и показывает текст.

- [ ] **Step 1: Тесты** `buildLeadPatch`: пустой email → `{email: null}`; `"350 000"` → `{deal_amount: 350000}`; пустое имя → бросает; `setter_id: ""` → `null`.
- [ ] **Step 2: Run** `npm test -- leadPatch`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** Каждое поле левой колонки, имя и телефон в шапке, все поля бывшей `EditLeadModal` в «Контакты и атрибуция» (Instagram, email, адрес, сайт, отрасль, сотрудников, уточнение источника, рилс, UTM ×4, внешний ID), комментарий — textarea. Сохранение — `leadApi.update(id, buildLeadPatch(...))`, затем `reload()`, тост «Сохранено». Нередактируемые (создан, обновлён, оплачено, остаток, комиссии, маржа) — текст. Убрать «Изменить» из `MoreMenu` и рендер `EditLeadModal`.
- [ ] **Step 4: Проверка Review Focus 5:** в превью задать сумму сделки ниже графика оплат → сообщение 422 показано, значение вернулось. `npm test`, `npm run build` — PASS.
- [ ] **Step 5: Commit** `feat(leadcard): inline field editing`.

### Task 11: «Показатели», меню, редиректы, уборка

**Files:**
- Create: `frontend/src/app/sales/metrics/page.tsx`, `frontend/src/components/sales/MetricsTotals.tsx`, `EmployeesTable.tsx`, `DiaryArchive.tsx`
- Modify: `frontend/src/components/Shell.tsx` (`SALES_SUBNAV`, бейдж на «Сегодня»), `frontend/src/app/analytics/page.tsx`, `frontend/src/app/tasks/page.tsx`, `frontend/src/app/leads/board/page.tsx`, `frontend/src/app/dept/[slug]/page.tsx`, `frontend/src/lib/api.ts` (`salesHubApi.metrics`)
- Delete: `frontend/src/components/departments/SalesDepartmentView.tsx`, `EditLeadModal` из `LeadModals.tsx`, неиспользуемые `leadApi.stats/funnelStats` на фронте

**Interfaces:**
- Consumes: `GET /api/sales-hub/metrics` (Task 4); `GET /api/sales/records`, `/api/sales/columns` (только чтение, для `DiaryArchive`).

- [ ] **Step 1: Страница «Показатели»:** период (сегодня/неделя/месяц/свой) и фильтры источник/услуга/сотрудник; один ряд итогов; воронка, график по дням, источники (компоненты взять из `analytics/page.tsx`); таблица сотрудников (сеттеры и клоузеры); свёрнутый «Архив дневника (ручной ввод)» — таблица записей за период без редактирования.
- [ ] **Step 2: Аналитика:** убрать с `/analytics` карточки лидов/встреч/продаж, полосу конверсий, воронку, график по дням, источники; оставить CPL, CAC, выручку vs план, средний чек, счета, ожидание оплаты, расходы, ФОТ, прибыль, прогноз, категории расходов, «Проблемы», выручку по услугам.
- [ ] **Step 3: Меню:** `SALES_SUBNAV` = Сегодня `/sales/today` (icon `wb_sunny`, бейдж просроченных — перенести с «Мои задачи»), Лиды `/leads` (`view_kanban`), Встречи `/sales/meetings` (`event`), Показатели `/sales/metrics` (`bar_chart`). Подсветка активного пункта для `/leads/*` и `/sales/*`.
- [ ] **Step 4: Редиректы** (`redirect()` из `next/navigation`, как `app/funnel/page.tsx`): `/tasks` → `/sales/today`; `/leads/board` → `/leads?view=board` + прочие query (ссылки из «Проблем» `/leads/board?overdue=true` должны работать); `/dept/sales` → `/sales/metrics`, с `meetings=1` → `/sales/meetings`. Обновить внутренние ссылки на старые адреса (`grep -rn "/leads/board\|/tasks\|/dept/sales" frontend/src backend/app`).
- [ ] **Step 5: Удалить** мёртвый код из списка Delete; `npm run lint` без новых предупреждений.
- [ ] **Step 6: Run** `pytest -q`, `npm test`, `npm run build`. Expected: всё PASS.
- [ ] **Step 7: Проверка в превью:** пройти утро сеттера (Сегодня → Взять лида → карточка → перевод во «Встречу» с окнами) и клоузера (Встречи → статус), руководителя (Показатели), открыть старые адреса — редиректы работают.
- [ ] **Step 8: Commit** `feat(sales): metrics page, new menu, redirects`; PR `dev` ← рабочая ветка.

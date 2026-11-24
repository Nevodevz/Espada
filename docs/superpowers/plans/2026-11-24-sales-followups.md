# Доработки продаж (клик, дубли, причина отказа, таймер) · План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клик по карточке открывает лида; дубли по номеру ловятся по цифрам при создании и правке; «Минус» только с причиной и статистика причин; таймер нового лида в рабочих минутах.

**Architecture:** Бэкенд: сервис `services/first_touch.py` (рабочие минуты + первое касание, общий источник касаний с `sales_metrics`), сервис дублей в `services/leads.py`, причины отказа в `sales_metrics`. Фронт: правки `LeadBoard`, `CreateLeadModal`, `InlineField`-сохранения телефона, `TransitionModal`, «Показатели».

**Tech Stack:** FastAPI, SQLAlchemy, pytest; Next.js 14, vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-sales-followups-design.md`

## Global Constraints

- Ветка `feat/sales-restructure` (PR #4 в `dev`). В коммитах не упоминать Claude.
- Рабочее время: 10:00–19:00 по Бишкеку (UTC+6), понедельник–пятница; константы `WORK_START_HOUR = 10`, `WORK_END_HOUR = 19`, `WORK_WEEKDAYS = {0, 1, 2, 3, 4}` в `services/first_touch.py`.
- Касание = результат звонка (`LeadActivity.call_result`), исходящее сообщение WhatsApp от сотрудника (`sender_user_id`, чат привязан к лиду), касание вручную (`LeadActivity` любого типа, кроме `stage_change`, `call_result`, `whatsapp`, с `responsible_id`) — как в «Показателях».
- Цвета таймера: < 15 мин — серый, 15–60 мин — жёлтый, > 60 мин — красный.
- Дубль = совпадение `normalize_phone` (из `services/whatsapp/phone.py`) номера с `phone` или `whatsapp` другого лида со `status == active`.
- «Минус» без активной причины → 422 «Укажите причину отказа».
- Тесты: `cd backend && .venv/Scripts/python -m pytest tests/<file> -q`; фронт `npm test`, `npx tsc --noEmit`. НЕ запускать `npm run build` и не трогать `frontend/.next` (работает dev-сервер) — сборку делает контролёр. Не коммитить `frontend/tsconfig.tsbuildinfo`.

## Review Focus

1. Лид пришёл в пятницу в 18:50, первое касание в понедельник в 10:05 → 15 рабочих минут, а не 2,5 суток (тест в Task 1).
2. Номер введён как `0700 123 456`, у существующего лида `+996 700 123456` в поле WhatsApp → дубль найден (тест в Task 2).
3. Лид переводят в «Минус» перетаскиванием на зону «Минус» без причины → окно не даёт сохранить, сервер отвечает 422 (тест в Task 3).
4. Лид в «Минусе» по старым данным без причины → в статистике строкой «Без причины», не ломает подсчёт (тест в Task 3).
5. У лида уже было касание до того, как его взяли → таймера на карточке нет (тест в Task 4).

---

### Task 1: Рабочие минуты и первое касание

**Files:**
- Create: `backend/app/services/first_touch.py`, `backend/tests/test_first_touch.py`
- Modify: `backend/app/services/sales_metrics.py` (`_touches` использует общий источник строк касаний)

**Interfaces:**
- Produces:
  - `working_minutes(start: datetime, end: datetime) -> int` — рабочие минуты между двумя моментами (UTC-aware), 0 если `end <= start`;
  - `touch_rows(db, *, start: datetime | None = None, end: datetime | None = None, lead_ids: list[int] | None = None) -> list[tuple[int, int, datetime]]` — `(user_id, lead_id, at)` из всех источников касаний; `_touches` в `sales_metrics` строится на нём;
  - `first_touch_at(db, lead_ids: list[int]) -> dict[int, datetime]` — самое раннее касание каждого лида.

- [ ] **Step 1: Тесты:**
  - `test_working_minutes_same_day` — 10:00→10:22 пн → 22;
  - `test_working_minutes_night_lead` — создан пн 23:00, сейчас вт 10:00 → 0; вт 10:30 → 30;
  - `test_working_minutes_over_weekend` — пт 18:50 → пн 10:05 → 15;
  - `test_working_minutes_before_open` — пн 08:00 → пн 11:00 → 60;
  - `test_first_touch_at_takes_earliest_of_sources` — звонок 12:00, исходящее WA 11:00, ручное касание 13:00 → 11:00; `stage_change` 10:00 не считается;
  - существующие `tests/test_sales_metrics.py` остаются зелёными.
- [ ] **Step 2: Run** `pytest tests/test_first_touch.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** Время переводить в Бишкек (`BISHKEK_TZ`), считать пересечение каждого дня с окном 10:00–19:00 только в рабочие дни.
- [ ] **Step 4: Run** `pytest tests/test_first_touch.py tests/test_sales_metrics.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): working-hours clock and first touch`.

### Task 2: Защита от дублей

**Files:**
- Modify: `backend/app/services/leads.py` (новая функция), `backend/app/routers/leads.py` (`create_lead`, новый `GET /api/leads/duplicates`), `frontend/src/components/leads/CreateLeadModal.tsx`, `frontend/src/app/leads/[id]/page.tsx` (сохранение `phone`/`whatsapp`), `frontend/src/lib/api.ts`
- Test: `backend/tests/test_lead_duplicates.py`, `frontend/src/lib/apiError.test.ts` (или новый)

**Interfaces:**
- Produces:
  - `find_duplicate_lead(db, phones: list[str], exclude_id: int | None = None) -> Lead | None` — первый активный лид, у которого `normalize_phone(phone)` или `normalize_phone(whatsapp)` совпадает с любым непустым нормализованным номером из `phones` (сравнение в Python по активным лидам с непустым номером);
  - `create_lead` использует её (409 с тем же `detail`: `message`, `existing{id, client_name, stage_id}`), проверяя `phone` и `whatsapp`;
  - `GET /api/leads/duplicates?phone=…&exclude_id=…` → `{"existing": {id, client_name, stage_id} | null}`;
  - фронт: `leadApi.findDuplicate(phone: string, excludeId?: number)`.

- [ ] **Step 1: Тесты:** `test_duplicate_by_digits` (`0700 123 456` ↔ `+996 700 123456`); `test_duplicate_matches_whatsapp_field`; `test_archived_lead_not_duplicate`; `test_exclude_self`; `test_create_returns_409_with_existing`; `test_duplicates_endpoint`. Фронт: helper, достающий `existing` из ошибки (`detail.existing`), — тест на объект ошибки, который бросает `request()` для 409.
- [ ] **Step 2: Run** `pytest tests/test_lead_duplicates.py -q`, `npm test`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** `CreateLeadModal`: окно «Лид с таким номером уже есть: <имя> · <этап>» с «Открыть» / «Всё равно создать» (повтор с `force: true`) — по `detail.existing`, не по тексту. Карточка лида: перед сохранением `phone`/`whatsapp` вызвать `findDuplicate`; при совпадении — `ConfirmModal` «Этот номер уже у лида <имя>» с «Открыть его» / «Всё равно сохранить» / «Отмена».
- [ ] **Step 4: Run** `pytest tests/test_lead_duplicates.py tests/test_meeting_for_lead.py -q`, `npm test`, `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(leads): duplicate check by phone digits`.

### Task 3: Обязательная причина отказа и статистика

**Files:**
- Modify: `backend/app/services/leads.py` (`_handle_lost_stage`), `backend/app/services/sales_metrics.py`, `backend/app/routers/sales_hub.py`, `frontend/src/components/TransitionModal.tsx`, `frontend/src/app/sales/metrics/page.tsx`, `frontend/src/lib/types.ts`
- Create: `frontend/src/components/sales/LostReasonsCard.tsx`
- Test: `backend/tests/test_lost_reasons.py`

**Interfaces:**
- Produces:
  - `_handle_lost_stage` бросает `StageTransitionError("Укажите причину отказа")` (→ 422), если `reject_reason_id` пуст или причина неактивна;
  - `lost_reasons(db, date_from: date, date_to: date, user_id: int | None = None) -> list[dict]` — `[{reason_id: int | None, name: str, count: int, pct: float, by_user: [{user_id, name, count}]}]`: лиды, перешедшие в этап `is_lost` в периоде (по `LeadStageHistory.created_at`, последний переход на лида), группировка по `lead.reject_reason_id`, `None` → имя «Без причины»; `by_user` — по `lead.setter_id`; `user_id` ограничивает сеттером;
  - `GET /api/sales-hub/metrics` добавляет `"lost_reasons"` (для не-руководителя — `user_id = сам`).

- [ ] **Step 1: Тесты:** `test_lost_without_reason_rejected` (смена этапа без причины → 422, этап прежний); `test_lost_with_inactive_reason_rejected`; `test_lost_with_reason_ok`; `test_no_answer_suggestion_path_still_works` (поток «Не выходит на связь» после 5 недозвонов проходит); `test_lost_reasons_counts_and_pct`; `test_lost_reasons_without_reason_row`; `test_lost_reasons_staff_only_own`.
- [ ] **Step 2: Run** `pytest tests/test_lost_reasons.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** `TransitionModal`: «Причина отказа *» обязательна, кнопка сохранения неактивна без неё. «Показатели»: карточка «Причины отказа за период» (причина · количество · доля; раскрытие по сотрудникам).
- [ ] **Step 4: Run** `pytest tests/test_lost_reasons.py tests/test_stage_transitions.py tests/test_lead_tasks_api.py tests/test_sales_metrics.py -q`, `npm test`, `npx tsc --noEmit`. Expected: PASS (поправить существующие тесты, переводящие в «Минус» без причины, — передать причину).
- [ ] **Step 5: Commit** `feat(sales): required loss reason and its stats`.

### Task 4: Таймер нового лида

**Files:**
- Modify: `backend/app/routers/lead_board.py` (поле карточки), `backend/app/services/sales_today.py` (`unclaimed_leads`), `backend/app/services/sales_metrics.py` (`employee_rows`), `frontend/src/components/leads/LeadBoard.tsx`, `frontend/src/components/sales/UnclaimedLeadsBlock.tsx`, `frontend/src/components/sales/EmployeesTable.tsx`, `frontend/src/lib/waiting.ts`, `frontend/src/lib/types.ts`
- Test: `backend/tests/test_first_touch.py` (расширить), `frontend/src/lib/waiting.test.ts`

**Interfaces:**
- Consumes: `working_minutes`, `first_touch_at` (Task 1).
- Produces:
  - карточка доски: `waiting_minutes: int | None` — рабочие минуты от `created_at` до сейчас, если у лида нет касаний и он на открытом этапе; иначе `None`;
  - `unclaimed_leads` → поле `waiting_minutes: int`;
  - строки сеттеров в метриках: `avg_first_touch_minutes: int | None`, `untouched: int` — по лидам сеттера, созданным в периоде; среднее рабочих минут до первого касания (только у тронутых), `untouched` — без касания;
  - фронт: `formatWaitingMinutes(min: number): string` («4 мин», «1 ч 10 мин», «2 дн» при ≥ 9 рабочих часов × N — считать день = 540 мин); `waitingLevel(min): "gray" | "yellow" | "red"`.

- [ ] **Step 1: Тесты:** бэкенд — `test_board_card_waiting_minutes_until_first_touch` (до касания число, после — `None`), `test_board_no_timer_when_touched_before_taken` (Review Focus 5), `test_unclaimed_waiting_minutes`, `test_avg_first_touch_per_setter`; фронт — `waitingLevel(14)="gray"`, `(15)="yellow"`, `(61)="red"`; `formatWaitingMinutes(70) === "1 ч 10 мин"`, `(540) === "1 дн"`.
- [ ] **Step 2: Run** соответствующие тесты. Expected: FAIL.
- [ ] **Step 3: Реализовать.** Карточка: бейдж «ждёт 22 мин» нужного цвета у лидов с `waiting_minutes != null`. Блок «Новые лиды, никто не взял» показывает `formatWaitingMinutes(waiting_minutes)` вместо календарного времени. Таблица сеттеров: колонки «Ср. время до касания» и «Без касания». Одним запросом `first_touch_at` на все лиды доски (без N+1).
- [ ] **Step 4: Run** `pytest tests/test_first_touch.py tests/test_lead_board.py tests/test_sales_today.py tests/test_sales_metrics.py -q`, `npm test`, `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(sales): new lead timer in working minutes`.

### Task 5: Клик по карточке

**Files:**
- Modify: `frontend/src/components/leads/LeadBoard.tsx` (`LeadCard`)
- Test: `frontend/src/lib/` helper test, если логика выносится

- [ ] **Step 1:** Клик по карточке (не по интерактивному элементу внутри — `a, button, input, select, textarea, [role=menu]`) переходит на `/leads/{id}` через `router.push`; после перетаскивания клик не срабатывает (dnd-kit уже глушит клик после drag — проверить, иначе флаг `justDragged`); курсор `pointer`; Enter на сфокусированной карточке тоже открывает лида, Пробел остаётся для перетаскивания (у `KeyboardSensor` по умолчанию перетаскивание стартует и по Enter — задать `keyboardCodes.start: ["Space"]`). Вынести проверку цели в `isInteractiveTarget(el: Element | null): boolean` с тестом.
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 3: Commit** `feat(leads): open lead by clicking anywhere on the card`.
- [ ] **Step 4 (контролёр):** сборка `npm run build` при остановленном dev-сервере; в браузере — клик по карточке, перетаскивание, таймер, дубль при создании и правке, «Минус» без причины, блок причин в «Показателях».

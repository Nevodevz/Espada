# Часть 2 — Одна доска по этапам · План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/leads/board` становится единственным канбаном. Столбцы — этапы воронки, перенос карточки меняет этап и запускает его действия: «Встреча» создаёт встречу в календаре с правильным временем.

**Architecture:** Тип этапа переезжает из угадывания по названию в колонку `lead_stages.kind`. Эндпоинт доски отдаёт этапы и открытые лиды. Свободные столбцы (`lead_board_*`) удаляются. Фронтенд при переносе на этап `generic` меняет этап сразу, а на остальные открывает существующий `TransitionModal`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, pytest (SQLite), Next.js 14, dnd-kit, vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-sales-crm-overhaul-design.md` §5.2

## Global Constraints

- Ветка: `dev` или фичевая ветка от `dev`. В коммитах и PR не упоминать Claude.
- Миграции: `023` (kind этапа, `down_revision="022"`) и `024` (удаление `lead_board_*`, `down_revision="023"`).
- Значения `kind`: ровно `generic | meeting | contract | waiting_payment | won | lost`.
- Время по Бишкеку — фиксированный сдвиг UTC+6 (`timezone(timedelta(hours=6))`). Летнего времени в Кыргызстане нет, `zoneinfo` не нужен.
- «Открытый лид» = `status == active` и `stage.kind not in ("won", "lost")`. Лиды без этапа считаются открытыми.
- Ручной порядок карточек внутри столбца не хранится.
- Этапы, история этапов, встречи и финансы существующих лидов не меняются ни одной миграцией.

## Review Focus

1. Админ переименовал «Встреча» в «Презентация» — перенос должен по-прежнему требовать дату и создавать встречу (тест в Task 1).
2. Перенос на «Оплачено» с неполной оплатой — сервер возвращает 422, карточка возвращается в исходный столбец, а пользователь видит текст ошибки (тест в Task 4).
3. Лид дважды заходит на «Встречу» (Встреча → Созвон → Встреча) — в календаре одна встреча, перенесённая на новое время (тест в Task 2).
4. Пока открыт `TransitionModal`, опрос доски каждые 30 секунд не должен перерисовать доску и сбросить перенос (тест в Task 4).
5. Встреча, введённая на 12:00, отображается в календаре в 12:00 по Бишкеку, а не в 18:00 (тест в Task 2).

---

### Task 1: Тип этапа хранится в `lead_stages.kind`

**Files:**
- Modify: `backend/app/models/__init__.py` (`LeadStage`: `kind: Mapped[str] = mapped_column(String(20), default="generic", nullable=False, server_default="generic")`)
- Create: `backend/migrations/versions/023_lead_stage_kind.py`
- Modify: `backend/app/services/leads.py:42-54` (`_stage_kind` возвращает `stage.kind`)
- Modify: `backend/app/routers/settings.py:27-42,51-70` (`StageCreate.kind`, `StageUpdate.kind`)
- Modify: `backend/tests/conftest.py` (фикстура `stages` задаёт `kind` каждому этапу)
- Modify: `frontend/src/lib/types.ts` (`StageKind`, `LeadStage.kind`)
- Modify: `frontend/src/components/TransitionModal.tsx:8-19` (`stageKind` возвращает `s.kind`)
- Modify: `frontend/src/app/admin/settings/page.tsx` (`StagesSection`: выбор типа)
- Test: `backend/tests/test_stage_kind.py`

**Interfaces:**
- Produces: `StageKind = Literal["generic","meeting","contract","waiting_payment","won","lost"]` в `backend/app/models/__init__.py` (экспортируется). `_stage_kind(stage) -> StageKind` (то же имя, другая реализация). На фронтенде `type StageKind` в `@/lib/types` и `stageKind(s: LeadStage): StageKind`.
- `StageCreate.kind: StageKind = "generic"`, `StageUpdate.kind: StageKind | None = None`. При записи `kind` сервер выставляет `is_won = kind == "won"` и `is_lost = kind == "lost"`.

- [ ] **Step 1: Write the failing tests** `backend/tests/test_stage_kind.py`

```python
from app.models import Meeting
from app.services.leads import change_lead_stage
from tests.conftest import auth_headers

def test_renamed_meeting_stage_still_creates_meeting(db, lead, stages):
    st = stages["Встреча"]; st.name = "Презентация"; db.commit()
    change_lead_stage(db, lead, st.id, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    assert db.query(Meeting).filter_by(lead_id=lead.id).count() == 1

def test_generic_stage_named_like_meeting_needs_no_date(client, admin, lead, stages, db):
    from app.models import LeadStage
    s = LeadStage(name="Встреча-2", position=10, kind="generic"); db.add(s); db.commit()
    r = client.patch(f"/api/leads/{lead.id}/stage", json={"to_stage_id": s.id}, headers=auth_headers(admin))
    assert r.status_code == 200, r.text

def test_setting_kind_syncs_won_lost_flags(client, admin, stages):
    sid = stages["Созвон"].id
    r = client.patch(f"/api/settings/stages/{sid}", json={"kind": "won"}, headers=auth_headers(admin))
    assert r.status_code == 200
    assert r.json()["kind"] == "won" and r.json()["is_won"] is True and r.json()["is_lost"] is False

def test_unknown_kind_is_rejected(client, admin, stages):
    r = client.patch(f"/api/settings/stages/{stages['Созвон'].id}", json={"kind": "demo"}, headers=auth_headers(admin))
    assert r.status_code == 422

def test_stages_list_exposes_kind(client, admin, stages):
    kinds = {s["name"]: s["kind"] for s in client.get("/api/settings/stages", headers=auth_headers(admin)).json()}
    assert kinds["Встреча"] == "meeting" and kinds["Минус"] == "lost" and kinds["Новый лид"] == "generic"
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python -m pytest tests/test_stage_kind.py -v`
Expected: FAIL (`kind` — неизвестный атрибут или параметр).

- [ ] **Step 3: Implement the model column, `_stage_kind`, settings schemas with the won/lost sync, and set `kind` in the `stages` fixture** (Новый лид/Созвон → generic, Встреча → meeting, Договор → contract, Ожидание оплаты → waiting_payment, Оплачено → won, Минус → lost).

- [ ] **Step 4: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: всё зелёное. Существующие тесты переходов проходят, потому что фикстура задаёт `kind`.

- [ ] **Step 5: Write migration `023_lead_stage_kind.py`**

`upgrade()`: добавить колонку с `server_default="generic"`, затем бэкфилл в порядке приоритета текущего `_stage_kind`. Для каждого правила — отдельный `UPDATE … WHERE kind='generic' AND …`, порядок важен:
1. `is_lost OR lower(name) LIKE '%минус%'` → `lost`
2. `is_won OR lower(name) LIKE '%оплач%'` → `won`
3. `lower(name) LIKE '%встреч%'` → `meeting`
4. `lower(name) LIKE '%договор%'` → `contract`
5. `lower(name) LIKE '%ожид%'` → `waiting_payment`

`downgrade()`: удалить колонку.

- [ ] **Step 6: Frontend — `stageKind` reads `s.kind`; in `StagesSection` add a `<Select>` «Тип» with labels** Обычный / Встреча / Договор / Ожидание оплаты / Оплачено / Минус, отправляется в create/update.

- [ ] **Step 7: Run frontend tests and build**

Run: `cd frontend && npm test && npm run build`
Expected: зелёное, без ошибок TypeScript.

- [ ] **Step 8: Verify migration 023 on PostgreSQL 16** (как в части 1, Task 1, шаг 7): на базе после `022` с этапами из seed `upgrade 023` даёт ожидаемые `kind`. Затем `downgrade 022` и снова `upgrade 023`.

- [ ] **Step 9: Commit**

```bash
git add backend frontend/src
git commit -m "feat(stages): explicit stage kind instead of name matching"
```

---

### Task 2: Встреча — время по Бишкеку и перенос вместо дубля

**Files:**
- Modify: `backend/app/services/leads.py:122-157` (`_handle_meeting_stage`)
- Test: `backend/tests/test_meeting_stage.py`

**Interfaces:**
- Consumes: `_stage_kind` из Task 1.
- Produces: `scheduled_meeting_for(db, lead_id: int) -> Meeting | None` в `backend/app/services/leads.py` — последняя встреча лида со `status == scheduled` и `parent_id IS NULL`. Её использует Task 3.

- [ ] **Step 1: Write the failing tests** `backend/tests/test_meeting_stage.py`

```python
from datetime import datetime, timezone
from app.models import Meeting, MeetingStatus
from app.services.leads import change_lead_stage

def test_meeting_time_is_entered_in_bishkek(db, lead, stages):
    change_lead_stage(db, lead, stages["Встреча"].id, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    m = db.query(Meeting).filter_by(lead_id=lead.id).one()
    assert m.meeting_date.replace(tzinfo=timezone.utc) == datetime(2026, 12, 1, 6, 0, tzinfo=timezone.utc)

def test_reentering_meeting_stage_reschedules_existing(db, lead, stages, other_staff):
    meet = stages["Встреча"].id
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    change_lead_stage(db, lead, stages["Созвон"].id)
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-03", "meeting_time": "15:30", "address": "Офис"})
    rows = db.query(Meeting).filter_by(lead_id=lead.id).all()
    assert len(rows) == 1
    assert rows[0].meeting_date.replace(tzinfo=timezone.utc) == datetime(2026, 12, 3, 9, 30, tzinfo=timezone.utc)
    assert rows[0].address == "Офис"

def test_closed_meeting_is_not_reused(db, lead, stages):
    meet = stages["Встреча"].id
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-01", "meeting_time": "12:00"})
    db.query(Meeting).filter_by(lead_id=lead.id).update({"status": MeetingStatus.not_held}); db.commit()
    change_lead_stage(db, lead, meet, extra_data={"meeting_date": "2026-12-05", "meeting_time": "10:00"})
    assert db.query(Meeting).filter_by(lead_id=lead.id).count() == 2
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python -m pytest tests/test_meeting_stage.py -v`
Expected: первый тест — FAIL (12:00 вместо 06:00), второй — FAIL (2 встречи).

- [ ] **Step 3: Implement** — парсить `meeting_date + meeting_time` как время в UTC+6 и переводить в UTC. Добавить `scheduled_meeting_for`. Если запланированная встреча есть, обновить у неё `meeting_date`, `address`, `notes`, `duration_minutes`, `closer_id`, а не создавать новую.

- [ ] **Step 4: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: всё зелёное.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/leads.py backend/tests/test_meeting_stage.py
git commit -m "fix(leads): meeting stage uses Bishkek time and reschedules the open meeting"
```

---

### Task 3: API доски по этапам, удаление свободных столбцов

**Files:**
- Rewrite: `backend/app/routers/lead_board.py`
- Create: `backend/app/services/lead_board.py`
- Modify: `backend/app/models/__init__.py` (удалить `LeadBoardColumn`, `LeadBoardPlacement`)
- Create: `backend/migrations/versions/024_drop_free_lead_board.py`
- Rewrite: `backend/tests/test_lead_board.py`

**Interfaces:**
- Consumes: `StageKind`, `scheduled_meeting_for` (Tasks 1–2). `LeadOut`, `_apply_list_filters`, `_deals_by_lead`, `_eager_lead`, `_lead_out` из `routers/leads.py` (как сейчас).
- Produces:
  - `GET /api/lead-board` — существующие фильтры плюс `mine: bool = False` (я сеттер или клоузер), `unassigned: bool = False` (`setter_id IS NULL`), `show_closed: bool = False`.
  - Ответ `BoardOut { stages: list[StageOut], leads: list[CardOut] }`. `StageOut {id, name, color, position, kind}` — все неархивные этапы по `position`. `CardOut(LeadOut) + scheduled_meeting: ScheduledMeetingOut | None`, где `ScheduledMeetingOut {id, meeting_date, duration_minutes, closer_id, address}`.
  - `board_sort_key(lead: Lead) -> tuple` в `services/lead_board.py`: сейчас `(-updated_at.timestamp(), -id)`. Части 3 и 4 расширят ключ, поэтому сортировка идёт только через эту функцию.
  - Эндпоинты `/api/lead-board/columns*` и `/api/lead-board/leads/{id}/move` удаляются. Перенос карточки идёт через существующий `PATCH /api/leads/{id}/stage`.

- [ ] **Step 1: Write the failing tests** — заменить `backend/tests/test_lead_board.py` (`from tests.conftest import auth_headers`):
  - `test_board_returns_active_stages_with_kind` — в `stages` ровно 7 неархивных этапов по `position`, у каждого есть `kind`. Архивный этап отсутствует.
  - `test_closed_leads_hidden_unless_requested` — лид в «Оплачено» и лид в «Минус» отсутствуют в `leads` без `show_closed` и присутствуют с `show_closed=true`.
  - `test_archived_leads_never_shown` — `status=archived` отсутствует даже с `show_closed=true`.
  - `test_mine_filter` — у `staff` с `mine=true` виден только лид, где он сеттер или клоузер.
  - `test_unassigned_filter` — с `unassigned=true` видны только лиды без сеттера.
  - `test_cards_sorted_by_last_activity` — лид с более поздним `updated_at` идёт первым.
  - `test_card_carries_scheduled_meeting` — после перехода на «Встречу» у карточки `scheduled_meeting.meeting_date` равен сохранённому значению. Без встречи — `null`.
  - `test_free_column_endpoints_are_gone` — `POST /api/lead-board/columns` возвращает 404 или 405.
  - Оставить без изменений: `test_unauthenticated_requests_are_rejected`, `test_invalid_date_filter_is_rejected`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python -m pytest tests/test_lead_board.py -v`
Expected: FAIL (в ответе нет `stages`, неизвестные параметры).

- [ ] **Step 3: Implement the new router and `board_sort_key`; remove the two models.**

- [ ] **Step 4: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: всё зелёное.

- [ ] **Step 5: Write migration `024_drop_free_lead_board.py`**

`upgrade()`: `op.drop_table("lead_board_placements")`, `op.drop_table("lead_board_columns")`. `downgrade()`: создать обе таблицы так же, как в `021.upgrade()` (пустыми). Docstring: «Перед upgrade на проде сделать `pg_dump -t lead_board_columns -t lead_board_placements` — см. DEPLOY.md».

- [ ] **Step 6: Verify 024 on PostgreSQL 16:** `upgrade 024`, `downgrade 023`, `upgrade 024` без ошибок.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(lead-board): board columns are funnel stages; drop free columns"
```

---

### Task 4: Фронтенд доски по этапам

**Files:**
- Rewrite: `frontend/src/components/leads/lead-board-layout.ts` и `lead-board-layout.test.ts`
- Rewrite: `frontend/src/components/leads/LeadBoard.tsx`
- Create: `frontend/src/components/leads/StageActionMenu.tsx` (меню «Действие» из `FunnelView.ActionDropdown`)
- Rewrite: `frontend/src/app/leads/board/page.tsx`
- Modify: `frontend/src/lib/api.ts:328-338` (`leadBoardApi.get(query)` с `mine`, `unassigned`, `show_closed`; функции столбцов удалить)
- Modify: `frontend/src/lib/types.ts:675-700` (`LeadBoardData {stages: LeadStage[]; leads: LeadBoardCard[]}`, `LeadBoardCard extends Lead {scheduled_meeting: ScheduledMeeting | null}`; удалить `LeadBoardColumn`, `LeadBoardMove`)
- Modify: `frontend/src/components/TransitionModal.tsx` (для `meeting`: если у `card.scheduled_meeting` есть значение, заполнить форму его датой, временем по Бишкеку, адресом, длительностью и клоузером и показать строку «Встреча уже назначена на дд.мм чч:мм — она будет перенесена»)

**Interfaces:**
- Consumes: `GET /api/lead-board` и `CardOut` из Task 3. `leadApi.changeStage(id, to_stage_id, comment, extra)` (уже есть). `TransitionModal` (уже есть). `closerOptions` из части 1.
- Produces (в `lead-board-layout.ts`):
  - `splitStages(stages: LeadStage[]): { columns: LeadStage[]; dropZones: LeadStage[] }` — в `dropZones` этапы `won`/`lost`, в `columns` остальные. Порядок по `position`.
  - `cardsForStage(cards: LeadBoardCard[], stageId: number): LeadBoardCard[]` — порядок сервера сохраняется.
  - `dropAction(from: number | null, to: LeadStage): "none" | "move" | "transition"` — тот же этап → `none`, `generic` → `move`, остальные → `transition`.
  - `applyOptimisticMove(cards: LeadBoardCard[], leadId: number, toStageId: number): LeadBoardCard[]`.

- [ ] **Step 1: Write the failing tests** `lead-board-layout.test.ts`: `splitStages` относит `won`/`lost` в `dropZones` и сортирует по `position`. `dropAction` возвращает `none`/`move`/`transition` для трёх случаев. `cardsForStage` фильтрует и сохраняет порядок. `applyOptimisticMove` меняет `stage_id` только у нужной карточки и не мутирует исходный массив.

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/leads/lead-board-layout.test.ts`
Expected: FAIL (функций нет).

- [ ] **Step 3: Implement the four layout functions.**

- [ ] **Step 4: Run to verify they pass** (та же команда). Expected: PASS.

- [ ] **Step 5: Rewrite `LeadBoard.tsx`**

Колонки — `columns` из `splitStages`, заголовок с цветом этапа и счётчиком. Под доской две широкие зоны для сброса из `dropZones`. Карточка: имя и компания, услуга, сумма сделки (если есть), «Сеттер: …», «Клоузер: …», `StageActionMenu` и ссылка на `/leads/{id}`. Перетаскивание на dnd-kit — как сейчас, но целью переноса служит этап. Сортировки внутри колонки и редактора столбцов нет. Выбор этапа с клавиатуры (как сейчас у столбцов) сохраняется через `StageActionMenu`.

- [ ] **Step 6: Rewrite `board/page.tsx` drag handling**

`onDrop(card, stage)`:
- `dropAction` = `move` — `applyOptimisticMove` и `changeStage`. При ошибке вернуть прежние данные и показать `toast.error(текст ошибки сервера)`.
- `transition` — открыть `TransitionModal`. «Отмена» ничего не меняет. При подтверждении — `changeStage(..., extra)`. При 422 модалка остаётся открытой с текстом ошибки, а доска перезагружается, потому что частичная оплата сохраняется.

Быстрые фильтры-переключатели над доской: «Мои лиды», «Неразобранные», «Показать закрытые» — синхронизируются с URL, как остальные фильтры. Опрос: `setInterval(load, 30_000)` только при `document.visibilityState === "visible"`, без открытой модалки и без идущей мутации.

- [ ] **Step 7: Add the polling guard test** в `lead-board-layout.test.ts`: `shouldPoll({ visible, modalOpen, mutating }): boolean` — `true` только при `visible && !modalOpen && !mutating`. Реализовать функцию в `lead-board-layout.ts` и использовать её в странице.

- [ ] **Step 8: Run frontend tests and build**

Run: `cd frontend && npm test && npm run build`
Expected: зелёное.

- [ ] **Step 9: Manual check in the app** (`/leads/board`, локально с seed):
  1. Перенести лида «Новый лид» → «Созвон»: карточка переезжает сразу, в истории лида есть смена этапа.
  2. Перенести на «Встречу»: открывается форма, указать 12:00 и клоузера. В календаре встреч отдела продаж встреча стоит на 12:00.
  3. Снова на «Созвон», затем на «Встречу»: форма предзаполнена, после сохранения в календаре одна встреча на новом времени.
  4. Сбросить на «Оплачено» с суммой меньше сделки: ошибка показана, карточка осталась на месте.
  5. «Показать закрытые» показывает лида в «Минус».

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "feat(lead-board): drag between funnel stages with stage transitions"
```

---

### Task 5: Убрать вид «Воронка» из `/leads`, документация

**Files:**
- Modify: `frontend/src/app/leads/page.tsx` (удалить `ViewSwitch`, `FunnelView`, `TransitionModal`-поток этой страницы. Ряд KPI воронки (`funnelStats`) показывать в списке. `?view=funnel` → `router.replace("/leads/board")`)
- Delete: `frontend/src/components/leads/FunnelView.tsx`
- Modify: `frontend/src/components/Shell.tsx` (если есть ссылки на `?view=funnel` — вести на `/leads/board`)
- Modify: `README.md` (раздел «Доска лидов», статус тестов, head `024`), `docs/product-spec.md` (§3 модули, §4 переходы и `kind`, раздел о доске, таблица API), `DEPLOY.md`

- [ ] **Step 1: Remove the funnel view and redirect `?view=funnel`.**
- [ ] **Step 2: Run** `cd frontend && npm test && npm run build`. Expected: зелёное. `grep -rn "FunnelView" frontend/src` ничего не находит.
- [ ] **Step 3: Write the DEPLOY.md section «Выкладка части 2»** — до `alembic upgrade`:
  1. `docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -t lead_board_columns -t lead_board_placements "$POSTGRES_DB"' > lead_board_backup_$(date +%F).sql`
  2. Выгрузить раскладку для руководителя продаж: `SELECT c.name, count(p.lead_id) FROM lead_board_columns c LEFT JOIN lead_board_placements p ON p.column_id=c.id GROUP BY c.name, c.position ORDER BY c.position;`
  3. Нужные столбцы завести этапами в «Справочники → Этапы воронки» **после** выкладки и при необходимости перевести лидов.
- [ ] **Step 4: Update README and product-spec.**
- [ ] **Step 5: Commit**

```bash
git add frontend/src README.md docs/product-spec.md DEPLOY.md
git commit -m "feat(leads): single stage board; remove funnel view; deploy notes"
```

---

### Task 6: Проверка старых встреч на сдвиг времени (операционная, без кода)

Выполняется на копии продовой базы (`pg_dump` → временный Postgres). Ничего не исправляется автоматически.

- [ ] **Step 1: Find meetings created by a stage change**

```sql
SELECT m.id, m.client_name, m.meeting_date, m.created_at
FROM meetings m
JOIN lead_stage_history h ON h.lead_id = m.lead_id
JOIN lead_stages s ON s.id = h.to_stage_id AND lower(s.name) LIKE '%встреч%'
WHERE m.lead_id IS NOT NULL
  AND abs(extract(epoch FROM (h.created_at - m.created_at))) < 5
ORDER BY m.created_at DESC;
```

- [ ] **Step 2: Report** пользователю: сколько таких встреч, примеры (время в UTC и как оно отображается), есть ли среди них будущие. Решение о миграции данных принимает пользователь вместе с отделом продаж.

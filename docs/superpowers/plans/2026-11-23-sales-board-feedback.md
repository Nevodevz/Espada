# Правки отдела продаж · План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Руководитель продаж сам настраивает этапы доски в окне «Настроить этапы»; «Отдел продаж» в верхней панели; карточка перетаскивается за любое место; «Сегодня» → «Мои задачи».

**Architecture:** Бэкенд: эндпоинты этапов в `routers/settings.py` пускают руководителя продаж с ограничениями на служебные этапы; список этапов умеет отдавать число открытых лидов. Фронтенд: новое окно `StageSettingsModal` на `/leads`, правки `Shell` и `LeadBoard`.

**Tech Stack:** FastAPI, SQLAlchemy, pytest; Next.js 14, @dnd-kit/core + @dnd-kit/sortable (уже в зависимостях), vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-sales-board-feedback-design.md`

## Global Constraints

- Ветка `feat/sales-restructure` (тот же PR в `dev`). В коммитах не упоминать Claude.
- Руководитель продаж = `is_sales_head` (бэкенд, `services/sales_access.py`) / `isSalesHead` (фронт, `lib/roles.ts`).
- Служебный этап = `kind != "generic"` («Встреча», «Договор», «Ожидание оплаты», «Оплачено», «Минус»): можно переименовать и перекрасить, нельзя удалить и сменить тип.
- Не-админ: запрещено менять `kind`/`is_won`/`is_lost`, архивировать служебный этап, создавать этап не `generic` → 422. Админ — как раньше.
- Новый этап встаёт в конец перед первым этапом `is_won`/`is_lost`.
- Перетаскивание карточки: мышь — сдвиг ≥ 6 px; касание — удержание 250 мс (tolerance 5 px).
- Верхняя панель во всех разделах продаж (`/sales/today`, `/leads`, `/sales/meetings`, `/sales/metrics`, `/leads/[id]`): «Отдел продаж».
- Пункт меню и заголовок `/sales/today`: «Мои задачи» (адрес не меняется).
- Тесты: `cd backend && .venv/Scripts/python -m pytest tests/<file> -q`; `cd frontend && npm test`, `npx tsc --noEmit`, `npm run build`. Не коммитить `frontend/tsconfig.tsbuildinfo`.

## Review Focus

1. Руководитель продаж удаляет этап, на котором стоят лиды → окно заранее говорит «N лидов переедут на этап «…»», и лиды действительно переезжают (тест в Task 1 на `lead_count` + `archive`).
2. Руководитель продаж пытается удалить «Встречу» запросом в обход интерфейса → 422, этап на месте (тест в Task 1).
3. Добавленный этап не встаёт после «Оплачено»/«Минус» (тест в Task 1).
4. Клик по карточке на доске по-прежнему открывает лида, «Взять себе» и меню этапа срабатывают, а не начинают перетаскивание (проверка в браузере в Task 3).
5. Обычный сотрудник не видит кнопку «Настроить этапы» и получает 403 от эндпоинтов (тест в Task 1, проверка в Task 2).

---

### Task 1: Права на этапы для руководителя продаж

**Files:**
- Modify: `backend/app/routers/settings.py` (stage endpoints ~142-232), `backend/app/core/deps.py` (новая зависимость)
- Test: `backend/tests/test_stage_permissions.py` (new)

**Interfaces:**
- Produces: `require_stage_editor(db, user) -> User` в `core/deps.py` — пропускает admin или `is_sales_head`, иначе 403 «Нет прав на настройку этапов».
- `GET /api/settings/stages?with_counts=true` → каждому этапу добавляется `lead_count: int` (лиды со `status == active` на этапе).
- `POST /stages`, `PATCH /stages/{id}`, `POST /stages/{id}/archive`, `POST /stages/{id}/reorder` используют `require_stage_editor`; ограничения для не-админа — Global Constraints.
- `POST /stages`: новый этап — позиция перед первым `is_won`/`is_lost` (остальные сдвигаются), для всех вызывающих.

- [ ] **Step 1: Тесты** (`head` = staff c `position="Руководитель продаж"`, `staff` — сеттер, фикстура `stages`, `lead`):
  - `test_head_can_create_rename_reorder_and_archive_generic` — 201/200 на каждое действие;
  - `test_new_stage_goes_before_won_and_lost` — после `POST` позиция нового < позиции «Оплачено» и «Минус»;
  - `test_head_cannot_archive_service_stage` — `archive` «Встречи» → 422, `is_archived` False;
  - `test_head_cannot_change_kind` — `PATCH {"kind": "won"}` / `{"is_lost": true}` → 422; `POST {"kind": "meeting"}` → 422;
  - `test_head_can_rename_service_stage` — `PATCH {"name": "Встреча с клиентом", "color": "#ff0000"}` у «Встречи» → 200;
  - `test_admin_unrestricted` — админ меняет `kind` и архивирует служебный этап как раньше;
  - `test_staff_forbidden` — сеттер получает 403 на все четыре метода;
  - `test_stage_lead_counts` — `with_counts=true`: у этапа `lead` `lead_count == 1`, архивный лид не считается.
- [ ] **Step 2: Run** `pytest tests/test_stage_permissions.py -q`. Expected: FAIL.
- [ ] **Step 3: Реализовать** по Interfaces.
- [ ] **Step 4: Run** `pytest tests/test_stage_permissions.py tests/test_stage_kind.py tests/test_lead_board.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(stages): sales head can configure board stages`.

### Task 2: Окно «Настроить этапы»

**Files:**
- Create: `frontend/src/components/leads/StageSettingsModal.tsx`, `frontend/src/lib/stageSettings.ts`, `frontend/src/lib/stageSettings.test.ts`
- Modify: `frontend/src/app/leads/page.tsx` (кнопка в шапке), `frontend/src/lib/api.ts` (`listStages(includeArchived, withCounts)`), `frontend/src/lib/types.ts` (`LeadStage.lead_count?: number`)

**Interfaces:**
- Consumes: эндпоинты Task 1.
- Produces:
  - `isServiceStage(s: Pick<LeadStage,"kind">): boolean` — `kind !== "generic"`;
  - `archiveTarget(stages: LeadStage[], id: number): LeadStage | null` — первый активный не-won/не-lost этап, кроме удаляемого (как бэкенд);
  - `archiveWarning(stage: LeadStage, target: LeadStage | null): string` — «На этапе «X» N лидов — они переедут на этап «Y».», при `lead_count === 0` — «Этап «X» будет удалён.», при `target === null` — «Удалить нельзя: некуда перенести лиды.»;
  - `<StageSettingsModal open onClose onChanged />`.

- [ ] **Step 1: Тесты** `stageSettings.test.ts`: `isServiceStage` для generic/meeting/won; `archiveTarget` пропускает удаляемый и won/lost; три варианта текста `archiveWarning` (N=3, N=0, target=null).
- [ ] **Step 2: Run** `npm test -- stageSettings`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** Окно: список активных этапов (`listStages(false, true)`), строки перетаскиваются (`@dnd-kit/sortable`, по отпусканию `reorderStage`); имя — поле, сохраняется по Enter/blur (`updateStage`); цвет — 8 цветов палитры; у служебных — подпись типа (`STAGE_KIND_LABELS`) и нет «Удалить»; «Удалить» → `ConfirmModal` с `archiveWarning` → `archiveStage`; «+ Добавить этап» → `createStage({name})`. Ошибки — `useToast` с текстом сервера. На `/leads` кнопка «⚙ Настроить этапы» только при `isSalesHead(me)`; после закрытия окна (`onChanged`) доска и фильтр этапов перечитывают этапы.
- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit`, `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(leads): stage settings window on the board`.

### Task 3: Заголовок, перетаскивание, «Мои задачи»

**Files:**
- Modify: `frontend/src/app/sales/today/page.tsx`, `frontend/src/app/leads/page.tsx`, `frontend/src/app/sales/meetings/page.tsx`, `frontend/src/app/sales/metrics/page.tsx`, `frontend/src/app/leads/[id]/page.tsx` (все `Shell title`), `frontend/src/components/Shell.tsx` (`SALES_SUBNAV`), `frontend/src/components/leads/LeadBoard.tsx` (sensors, `LeadCard`)

- [ ] **Step 1:** Во всех перечисленных страницах `Shell title="Отдел продаж"` (включая состояния загрузки и Suspense-заглушки). На `/sales/today` крупный заголовок страницы «Мои задачи» вместо заголовка блока внутри (не дублировать: один заголовок «Мои задачи»). В `SALES_SUBNAV` пункт `/sales/today` → «Мои задачи» (иконка `task_alt`).
- [ ] **Step 2:** `LeadBoard`: `listeners`/`attributes` перенести с кнопки-ручки на `<article>` карточки; ручку оставить как значок (без своих listeners, `aria-hidden`), клавиатурное перетаскивание — через `attributes` на карточке; сенсоры: `PointerSensor { distance: 6 }` для мыши и `TouchSensor { delay: 250, tolerance: 5 }`; кнопки внутри карточки («Взять себе», меню этапа, ссылка на лида) не должны запускать перетаскивание — `onPointerDown` у них `stopPropagation`, если dnd-kit их не пропускает сам.
- [ ] **Step 3: Run** `npm test`, `npx tsc --noEmit`, `npm run build`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(sales): sales header, drag whole card, rename Today to My tasks`.
- [ ] **Step 5 (контролёр):** в браузере — тащить карточку за середину, клик открывает лида, «Взять себе» не тащит; верхняя панель «Отдел продаж» на всех разделах; окно «Настроить этапы»: переименовать, добавить, перетащить, удалить пустой этап.

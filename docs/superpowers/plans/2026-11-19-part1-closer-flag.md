# Часть 1 — Клоузер как признак сотрудника · План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клоузер определяется галочкой `users.is_closer`, а не текстом должности. Адахан появляется во всех списках клоузеров.

**Architecture:** Новая булева колонка с миграцией-бэкфиллом. Поле есть в схемах пользователя, менять его может только admin. На фронтенде одна функция-предикат заменяет три копии списка должностей.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, pytest (SQLite), Next.js 14, vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-sales-crm-overhaul-design.md` §5.1

## Global Constraints

- Ветка: работа идёт в `dev` (или в фичевой ветке от `dev`). В `main` не коммитить.
- В сообщениях коммитов и PR не упоминать Claude, без `Co-Authored-By`.
- Номер миграции: `022`, `down_revision = "021"`.
- Бэкфилл: `is_closer = true` для `position IN ('Клоузер', 'Финансовый директор')` и для `email LIKE 'adahan@%'`.
- Права на смену статуса встречи не меняются: клоузер этой встречи или admin.

## Review Focus

1. Сотрудник (staff) отправляет `PATCH /api/users/{свой id}` с `is_closer: true` — поле должно молча игнорироваться, как `role` (тест в Task 1).
2. Архивный сотрудник (`is_active=false`) с `is_closer` не должен попадать в выпадающие списки клоузеров (тест в Task 2).
3. Адахан не состоит в отделе продаж — в календаре встреч он всё равно должен быть клоузером (Task 2, шаг 5: списки строятся из всех пользователей, а не из участников отдела).
4. У лида уже назначен клоузер, у которого потом сняли галочку. Карточка лида должна показывать его имя, а не пустоту (Task 2, шаг 6).
5. Миграция на базе, где у Адахана другая должность и email `adahan@…`, всё равно ставит ему галочку (Task 1, шаг 7: проверка на PostgreSQL).

---

### Task 1: Бэкенд — поле `is_closer`

**Files:**
- Modify: `backend/app/models/__init__.py` (класс `User`)
- Create: `backend/migrations/versions/022_user_is_closer.py`
- Modify: `backend/app/schemas/__init__.py` (`UserCreate`, `UserUpdate`, `UserOut`)
- Modify: `backend/app/routers/users.py:128` (список защищённых полей) и `create_user` (передать `is_closer`)
- Modify: `backend/app/routers/meetings.py:66-67` (удалить неиспользуемый `_CLOSER_POSITIONS` вместе с комментарием)
- Test: `backend/tests/test_closer_flag.py`

**Interfaces:**
- Produces: `User.is_closer: bool` (по умолчанию `False`, `server_default="false"`). `UserOut.is_closer: bool`. `UserCreate.is_closer: bool = False`. `UserUpdate.is_closer: Optional[bool] = None`.

- [ ] **Step 1: Write the failing tests** в `backend/tests/test_closer_flag.py`

```python
from tests.conftest import auth_headers

def test_users_list_exposes_is_closer(client, admin, staff):
    r = client.get("/api/users", headers=auth_headers(admin))
    assert r.status_code == 200
    assert all("is_closer" in u for u in r.json())
    assert next(u for u in r.json() if u["id"] == staff.id)["is_closer"] is False

def test_admin_can_toggle_is_closer(client, db, admin, staff):
    r = client.patch(f"/api/users/{staff.id}", json={"is_closer": True}, headers=auth_headers(admin))
    assert r.status_code == 200 and r.json()["is_closer"] is True
    db.refresh(staff); assert staff.is_closer is True

def test_staff_cannot_make_self_closer(client, db, staff):
    r = client.patch(f"/api/users/{staff.id}", json={"is_closer": True, "name": "Новое"}, headers=auth_headers(staff))
    assert r.status_code == 200
    db.refresh(staff)
    assert staff.is_closer is False and staff.name == "Новое"

def test_admin_creates_user_as_closer(client, admin):
    r = client.post("/api/users", headers=auth_headers(admin), json={
        "name": "Адахан", "email": "adahan@test.kg", "password": "x12345678",
        "position": "Финансы", "is_closer": True})
    assert r.status_code in (200, 201) and r.json()["is_closer"] is True
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && python -m pytest tests/test_closer_flag.py -v`
Expected: FAIL — `KeyError`/`AssertionError` на `is_closer`.

- [ ] **Step 3: Add `is_closer` to the model and schemas; add `"is_closer"` to the protected tuple in `update_user`; pass `is_closer=payload.is_closer` in `create_user`.**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_closer_flag.py -v`
Expected: 4 passed.

- [ ] **Step 5: Write migration `022_user_is_closer.py`**

`upgrade()`: `op.add_column("users", sa.Column("is_closer", sa.Boolean(), nullable=False, server_default=sa.false()))`, затем один `op.execute` с `UPDATE users SET is_closer = true WHERE position IN ('Клоузер', 'Финансовый директор') OR email LIKE 'adahan@%'`. `downgrade()`: `op.drop_column("users", "is_closer")`.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: все тесты проходят (было 121, стало 125).

- [ ] **Step 7: Verify the migration on PostgreSQL 16**

```bash
docker run -d --name esp-pg -e POSTGRES_PASSWORD=pass -e POSTGRES_USER=espada -e POSTGRES_DB=espada -p 55432:5432 postgres:16-alpine
cd backend && POSTGRES_HOST=localhost POSTGRES_PORT=55432 POSTGRES_PASSWORD=pass python -m alembic upgrade 021
```
Вставить двух пользователей через `psql`: одного с `position='Финансы', email='adahan@espada.kg'` и одного с `position='Сеттер'`. Затем `alembic upgrade 022`, `SELECT email, is_closer FROM users` — ожидается `true` у Адахана и `false` у сеттера. Потом `alembic downgrade 021` и снова `alembic upgrade 022` без ошибок. Затем `docker rm -f esp-pg`.

- [ ] **Step 8: Commit**

```bash
git add backend/app backend/migrations/versions/022_user_is_closer.py backend/tests/test_closer_flag.py
git commit -m "feat(users): explicit is_closer flag with backfill for closers and Adahan"
```

---

### Task 2: Фронтенд — один предикат «клоузер» и галочка в карточке сотрудника

**Files:**
- Create: `frontend/src/lib/roles.ts`
- Test: `frontend/src/lib/roles.test.ts`
- Modify: `frontend/src/lib/types.ts` (`User.is_closer: boolean`)
- Modify: `frontend/src/components/UserModal.tsx` (галочка «Клоузер» рядом с `is_founder`, отправляется в create/update)
- Modify: `frontend/src/components/meetings/SalesMeetingsCalendar.tsx:18-21,82,116`
- Modify: `frontend/src/components/departments/SalesDepartmentView.tsx:9,19-20,313,322`
- Modify: выпадающие списки «Клоузер» в `frontend/src/components/TransitionModal.tsx`, `frontend/src/components/leads/CreateLeadModal.tsx:181-183`, `frontend/src/app/leads/[id]/page.tsx` (`EditLeadModal`, поле «Клоузер» у строки 359)

**Interfaces:**
- Consumes: `UserOut.is_closer` из Task 1.
- Produces: `isCloser(u: Pick<User, "is_closer" | "is_active">): boolean` и `closerOptions<T extends User>(users: T[], keepId?: number | null): T[]` в `@/lib/roles`. `closerOptions` возвращает активных клоузеров, отсортированных по `name` (`localeCompare("ru")`), плюс пользователя `keepId`, если он есть в `users`, но не клоузер.

- [ ] **Step 1: Write the failing test** `frontend/src/lib/roles.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { closerOptions, isCloser } from "./roles";
const u = (id: number, name: string, is_closer: boolean, is_active = true) =>
  ({ id, name, is_closer, is_active }) as any;

describe("closers", () => {
  it("uses the flag, not the position", () => {
    expect(isCloser({ is_closer: true, is_active: true })).toBe(true);
    expect(isCloser({ is_closer: false, is_active: true })).toBe(false);
  });
  it("hides archived closers", () => {
    expect(isCloser({ is_closer: true, is_active: false })).toBe(false);
  });
  it("lists active closers by name and keeps the currently assigned one", () => {
    const list = [u(1, "Марлен", true), u(2, "Адахан", true), u(3, "Рахима", false), u(4, "Старый", true, false)];
    expect(closerOptions(list).map((x) => x.id)).toEqual([2, 1]);
    expect(closerOptions(list, 3).map((x) => x.id)).toEqual([2, 1, 3]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/lib/roles.test.ts`
Expected: FAIL — module `./roles` not found.

- [ ] **Step 3: Implement `isCloser` and `closerOptions` in `frontend/src/lib/roles.ts`; add `is_closer` to `User` in `types.ts`.**

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/lib/roles.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Replace position-based closer detection**

Удалить `CLOSER_POSITIONS` из обоих файлов. Экспорт `isCloser` из `SalesMeetingsCalendar` удалить, импортировать из `@/lib/roles`. В `SalesMeetingsCalendar` список клоузеров строится из `api.listUsers()` (все пользователи), а не из участников отдела: `closers = closerOptions(allUsers)`. Сеттеры по-прежнему берутся из `members`. В `SalesDepartmentView.MeetingsTableModal` `closers = closerOptions(allUsers)`, а определение роли `filterRole` использует `isCloser(initUser)`.

- [ ] **Step 6: Restrict «Клоузер» dropdowns to closers**

В `TransitionModal`, `CreateLeadModal` и `EditLeadModal` опции поля «Клоузер» = `closerOptions(users, текущий closer_id)`. Списки «Сеттер» не меняются.

- [ ] **Step 7: Add the «Клоузер» checkbox to `UserModal`**

Галочка видна только admin (тем же условием, что «Основатель»). `is_closer` есть в начальном состоянии формы (`false` для нового, `user.is_closer` для существующего) и уходит в payload.

- [ ] **Step 8: Run frontend tests and build**

Run: `cd frontend && npm test && npm run build`
Expected: все тесты проходят (39 → 42), сборка успешна, ошибок TypeScript нет.

- [ ] **Step 9: Manual check in the app**

Поднять стек локально (бэкенд + фронтенд по README). Под admin открыть сотрудника и включить «Клоузер». Затем: «Отдел продаж» → календарь встреч → «Новая встреча» — сотрудник есть в списке клоузеров. В воронке перевести лида на «Встречу» — он есть и там.

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "feat(sales): closer dropdowns use is_closer flag; closer checkbox in staff modal"
```

---

### Task 3: Документация

**Files:**
- Modify: `docs/product-spec.md` (§2 «Функциональные роли отдела продаж»: клоузер = галочка `is_closer`)
- Modify: `README.md` (статус тестов, head-миграция `022`)
- Modify: `HANDOFF.md` (Адахан — клоузер)

- [ ] **Step 1: Update the three docs.**
- [ ] **Step 2: Commit**

```bash
git add docs/product-spec.md README.md HANDOFF.md
git commit -m "docs: closer flag"
```

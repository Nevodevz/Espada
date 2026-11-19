# Часть 4 — WhatsApp в CRM · План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Входящие WhatsApp-сообщения на общий номер отдела становятся лидами или попадают в чат существующего лида, а сотрудники переписываются с клиентом прямо из карточки лида.

**Architecture:** Evolution API v2.3.7 работает в отдельном контейнере внутренней сети и шлёт вебхуки в бэкенд по секретному пути. Бэкенд разбирает события через адаптер провайдера (`services/whatsapp/`), хранит чаты и сообщения в своих таблицах, а файлы — вне публичного `/media`. Фронтенд опрашивает API: чат раз в 5 секунд, доску раз в 30 секунд.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, httpx (уже в requirements), pytest (SQLite), Next.js 14, vitest, Docker Compose, Evolution API `evoapicloud/evolution-api`.

**Spec:** `docs/superpowers/specs/2026-11-19-sales-crm-overhaul-design.md` §5.4 (и §6 «Риски»)

## Global Constraints

- Ветка `dev`; в коммитах и PR не упоминать Claude.
- Миграция: `025`, `down_revision = "024"`.
- **Evolution API закреплён на v2.3.7.** 2.4.x требует лицензию (все запросы → 503 `LICENSE_REQUIRED`). Тег образа проверить `docker pull` (Task 9).
- Факты Evolution 2.3.7 (по исходникам тега `2.3.7`, документация недоступна):
  - заголовок авторизации `apikey`;
  - `POST /instance/create` `{instanceName, integration:"WHATSAPP-BAILEYS", qrcode:true, groupsIgnore:true, webhook:{enabled:true, url, events:[…], byEvents:false, base64:true}}`;
  - `GET /instance/connect/{name}` → при `state=open` `{instance:{state}}`, иначе `{pairingCode, code, base64, count}`;
  - `GET /instance/connectionState/{name}` → `{instance:{instanceName, state}}`, `state ∈ open|connecting|close` (в вебхуке ещё `refused`);
  - `DELETE /instance/logout/{name}`;
  - `POST /message/sendText/{name}` `{number, text}`;
  - `POST /message/sendMedia/{name}` `{number, mediatype: image|document|video|audio, mimetype, caption, media: <base64>, fileName}`;
  - ответы отправки — объект сообщения с `key.id`.
- Конверт вебхука: `{event, instance, data, destination, date_time, sender, server_url, apikey}`. Имена событий в нижнем регистре через точку: `messages.upsert`, `messages.update`, `connection.update`, `qrcode.updated`. При создании инстанса подписываемся на `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`.
- `messages.upsert` `data`: `key{remoteJid, remoteJidAlt?, fromMe, id}`, `pushName`, `message{conversation | imageMessage{caption,mimetype} | documentMessage{fileName,mimetype,caption} | audioMessage{mimetype} | videoMessage{caption,mimetype} | base64?}`, `messageType`, `messageTimestamp` (unix seconds). `extendedTextMessage` уже превращён в `conversation`.
- `messages.update` `data`: `{keyId, remoteJid, fromMe, status}`, где `status ∈ ERROR|PENDING|SERVER_ACK|DELIVERY_ACK|READ|PLAYED`.
- Идентификаторы чатов: `…@s.whatsapp.net` — личный чат, `…@g.us` — группа (игнорировать), `status@broadcast` — статусы (игнорировать), `…@lid` — брать `key.remoteJidAlt`, если он есть, иначе игнорировать.
- Номер отдела продаж к локальной среде не подключается никогда, проверка идёт только на тестовом номере (спек §8).
- Файлы клиентов не попадают в публичный `/media`. Хранятся в `MEDIA_ROOT/whatsapp/`, а nginx отдаёт `alias /var/www/media/` целиком. Поэтому каталог должен лежать **вне** тома `media`: отдельный том `whatsapp_media` → `/app/whatsapp_media`, настройка `WHATSAPP_MEDIA_ROOT`.
- Нормализация номера: только цифры. `0XXXXXXXXX` (10 цифр) и `XXXXXXXXX` (9 цифр) → `996XXXXXXXXX`. Остальное — как есть.
- Права на чат: admin, `is_founder`, `is_closer`, участник отдела `slug="sales"`.

## Review Focus

1. Evolution повторно присылает то же `messages.upsert` (повтор вебхука) — второго сообщения и второго лида быть не должно (тест в Task 4).
2. Клиент пишет с номером, который в CRM записан как `0700 123 456`, а в WhatsApp пришёл как `996700123456` — сообщение попадает к этому лиду (тест в Task 1 + Task 4).
3. Вебхук с неверным секретом или без него не создаёт ничего и не раскрывает, существует ли путь (404) (тест в Task 5).
4. Отправка, когда Evolution недоступен или номер отключён, — сотрудник видит ошибку, а сообщение помечено `failed`, а не «отправлено» (тест в Task 6).
5. Файл клиента недоступен без входа и сотруднику без прав на чат (тест в Task 6).

---

## File Structure

```
backend/app/services/whatsapp/__init__.py
backend/app/services/whatsapp/phone.py       normalize_phone, jid_to_phone
backend/app/services/whatsapp/provider.py    InboundMessage, StatusUpdate, ConnectionUpdate, SendResult, WhatsAppProvider (Protocol), ProviderError
backend/app/services/whatsapp/evolution.py   EvolutionProvider (httpx), parse_webhook
backend/app/services/whatsapp/inbound.py     handle_events(db, events, provider)
backend/app/services/whatsapp/access.py      can_use_whatsapp(db, user)
backend/app/services/whatsapp/media.py       save_media(...), media_path(...)
backend/app/services/whatsapp/runtime.py     get_provider() — DI; None если не настроено
backend/app/routers/whatsapp.py              webhook, admin, chat API
backend/migrations/versions/025_whatsapp.py
frontend/src/lib/whatsapp.ts (+ .test.ts)    mergeMessages, messageLabel
frontend/src/components/whatsapp/LeadWhatsAppChat.tsx
frontend/src/app/admin/whatsapp/page.tsx
docker-compose.whatsapp-dev.yml              локальный Evolution для тестового номера
```

---

### Task 1: Нормализация номера и поиск лида по номеру

**Files:**
- Create: `backend/app/services/whatsapp/__init__.py`, `backend/app/services/whatsapp/phone.py`
- Modify: `backend/app/models/__init__.py` (`Lead.phone_digits`, `Lead.whatsapp_digits`: `String(32)`, `default=""`, `index=True`; listener SQLAlchemy `before_insert`/`before_update` на `Lead` заполняет их из `phone`/`whatsapp` через `normalize_phone`)
- Test: `backend/tests/test_whatsapp_phone.py`

**Interfaces:**
- Produces: `normalize_phone(raw: str | None) -> str` и `jid_to_phone(jid: str) -> str | None` (`"996700123456@s.whatsapp.net"` → `"996700123456"`; `@g.us`, `status@broadcast`, `@lid` → `None`) в `app.services.whatsapp.phone`. Колонки `Lead.phone_digits`, `Lead.whatsapp_digits`.

- [ ] **Step 1: Write the failing tests**

```python
import pytest
from app.models import Lead, LeadStatus
from app.services.whatsapp.phone import jid_to_phone, normalize_phone

@pytest.mark.parametrize("raw,expected", [
    ("+996 700 123 456", "996700123456"), ("0700 123 456", "996700123456"),
    ("700123456", "996700123456"), ("8 (701) 234-56-78", "87012345678"), ("", ""), (None, ""),
])
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected

@pytest.mark.parametrize("jid,expected", [
    ("996700123456@s.whatsapp.net", "996700123456"), ("1203630@g.us", None),
    ("status@broadcast", None), ("12345@lid", None),
])
def test_jid_to_phone(jid, expected):
    assert jid_to_phone(jid) == expected

def test_lead_digits_kept_in_sync(db, stages):
    lead = Lead(client_name="A", phone="0700 123 456", whatsapp="", stage_id=stages["Новый лид"].id, status=LeadStatus.active)
    db.add(lead); db.commit()
    assert lead.phone_digits == "996700123456" and lead.whatsapp_digits == ""
    lead.whatsapp = "+996 555 000 111"; db.commit()
    assert lead.whatsapp_digits == "996555000111"
```

- [ ] **Step 2: Run** `cd backend && .venv/Scripts/python -m pytest tests/test_whatsapp_phone.py -q`. Expected: FAIL (`ModuleNotFoundError`).
- [ ] **Step 3: Implement** `phone.py`, two columns and the listener.
- [ ] **Step 4: Run** the same command. Expected: all pass.
- [ ] **Step 5: Commit** `feat(whatsapp): phone normalization and digit columns on leads`

---

### Task 2: Модели и миграция 025

**Files:**
- Modify: `backend/app/models/__init__.py`
- Create: `backend/migrations/versions/025_whatsapp.py`
- Test: `backend/tests/test_whatsapp_models.py`

**Interfaces:**
- Produces:
  - `WhatsAppChat` (`whatsapp_chats`): `id`, `remote_jid` (String 64, unique), `phone` (String 32, index), `lead_id` (FK leads SET NULL, index), `created_lead_id` (FK leads SET NULL; лид, созданный из этого чата), `push_name` (String 200, ""), `last_message_at` (DateTime tz, null), `unread_count` (Integer, 0), `is_ignored` (Boolean, false), `created_at`.
  - `WhatsAppMessage` (`whatsapp_messages`): `id`, `chat_id` (FK CASCADE, index), `external_id` (String 128, unique, nullable — до ответа провайдера), `direction` (String 3: `in`/`out`), `sender_user_id` (FK users SET NULL, null), `kind` (String 16: `text|image|document|audio|video|other`), `body` (Text, ""), `media_path` (String 500, ""), `media_mime` (String 120, ""), `media_name` (String 255, ""), `status` (String 16: `pending|sent|delivered|read|failed|received`), `error` (String 500, ""), `sent_at` (DateTime tz, index), `created_at`.
  - `WhatsAppState` (`whatsapp_state`, одна строка `id=1`): `state` (String 16, `"unknown"`), `updated_at`.
- Migration `025`: три таблицы, колонки `leads.phone_digits`/`whatsapp_digits` с индексами и бэкфилл из `phone`/`whatsapp`. Функция нормализации копируется в миграцию (миграции не импортируют `app`). Downgrade удаляет всё это.

- [ ] **Step 1: Write the failing test** `test_whatsapp_models.py::test_chat_message_roundtrip` — создать чат и два сообщения (`in` и `out` с `external_id=None`). Затем удаление чата каскадно удаляет сообщения, а удаление лида оставляет чат с `lead_id=None`. Повторный `external_id` даёт `IntegrityError`.
- [ ] **Step 2: Run**. Expected: FAIL (ImportError).
- [ ] **Step 3: Implement** models and migration 025 (backfill — Python loop over `leads` via `op.get_bind()`).
- [ ] **Step 4: Run** the test, then the full suite `.venv/Scripts/python -m pytest -q`. Expected: green.
- [ ] **Step 5: PG verify** on a temporary `postgres:16-alpine`: `alembic upgrade head` from 024 with a lead `phone='0700 123 456'` gives `phone_digits='996700123456'`. Then `downgrade 024` and `upgrade 025` succeed.
- [ ] **Step 6: Commit** `feat(whatsapp): chat, message and connection-state tables (migration 025)`

---

### Task 3: Адаптер провайдера и разбор вебхуков Evolution

**Files:**
- Create: `backend/app/services/whatsapp/provider.py`, `backend/app/services/whatsapp/evolution.py`
- Modify: `backend/app/core/config.py` (`EVOLUTION_URL: str = ""`, `EVOLUTION_API_KEY: str = ""`, `WHATSAPP_INSTANCE: str = "espada-sales"`, `WHATSAPP_WEBHOOK_SECRET: str = ""`, `WHATSAPP_WEBHOOK_BASE: str = "http://backend:8000"`, `WHATSAPP_MEDIA_ROOT: str = "/app/whatsapp_media"`, `WHATSAPP_MAX_UPLOAD_BYTES: int = 16 * 1024 * 1024`)
- Test: `backend/tests/test_whatsapp_evolution.py` (+ `backend/tests/fixtures/evolution/*.json`: `upsert_text.json`, `upsert_image_base64.json`, `upsert_group.json`, `upsert_lid.json`, `upsert_from_me.json`, `update_read.json`, `connection_open.json`)

**Interfaces:**
- Produces (in `provider.py`, dataclasses, frozen):
  - `InboundMessage(external_id: str, remote_jid: str, phone: str, from_me: bool, push_name: str, kind: str, body: str, media_b64: str | None, media_mime: str, media_name: str, sent_at: datetime)`
  - `StatusUpdate(external_id: str, status: str)` — `status` уже в нашей шкале: `SERVER_ACK→sent`, `DELIVERY_ACK→delivered`, `READ|PLAYED→read`, `ERROR→failed`, `PENDING→pending`.
  - `ConnectionUpdate(state: str)`
  - `SendResult(external_id: str)`
  - `class ProviderError(Exception)`
  - `class WhatsAppProvider(Protocol)`: `ensure_instance(webhook_url: str) -> None`; `connect() -> dict` (`{"state": str, "qr_base64": str | None, "pairing_code": str | None}`); `state() -> str`; `logout() -> None`; `send_text(phone: str, text: str) -> SendResult`; `send_media(phone: str, data: bytes, mime: str, file_name: str, caption: str) -> SendResult`.
- In `evolution.py`:
  - `EvolutionProvider(base_url: str, api_key: str, instance: str, client: httpx.Client | None = None)` реализует протокол. Любой не-2xx ответ или сетевая ошибка → `ProviderError`. `ensure_instance` создаёт инстанс, если `connectionState` вернул 404, а у существующего обновляет вебхук через `POST /webhook/set/{name}` `{webhook:{enabled, url, events, byEvents:false, base64:true}}`.
  - `parse_webhook(payload: dict) -> list[InboundMessage | StatusUpdate | ConnectionUpdate]` игнорирует группы, `status@broadcast`, `@lid` без `remoteJidAlt`, сообщения без текста и медиа (реакции, протокол) и неизвестные события. `kind` определяется по `messageType`/ключу (`imageMessage→image` и т. д.), `body` — `conversation` или `caption`.

- [ ] **Step 1: Write the failing tests:**
  - `test_parse_text_message` — `InboundMessage` c `phone="996700123456"`, `body`, `push_name`, `from_me=False`, `sent_at` из `messageTimestamp`.
  - `test_parse_image_with_base64` — `kind="image"`, `media_b64` не пуст, `media_mime="image/jpeg"`, `body` = подпись.
  - `test_group_and_broadcast_ignored` — `[]`.
  - `test_lid_uses_remote_jid_alt` — номер из `remoteJidAlt`, а без него `[]`.
  - `test_from_me_kept` — `from_me=True`.
  - `test_status_update_mapped` — `READ` → `StatusUpdate(status="read")`.
  - `test_connection_update` — `ConnectionUpdate("open")`.
  - `test_send_text_posts_number_and_apikey` — `httpx.MockTransport` проверяет `POST /message/sendText/espada-sales`, заголовок `apikey`, тело `{"number": "996700123456", "text": "Здравствуйте"}`, и возвращает `{"key":{"id":"ABC"}}` → `SendResult("ABC")`.
  - `test_http_error_raises_provider_error` — 500 → `ProviderError`, `httpx.ConnectError` → `ProviderError`.
  - `test_connect_returns_qr_when_not_open` — ответ `{"base64":"data:image/png;base64,xx","pairingCode":"AB12"}` → `{"state":"connecting","qr_base64":…,"pairing_code":"AB12"}`.
  - `test_ensure_instance_creates_when_missing` — 404 на `connectionState` → `POST /instance/create` с `webhook.url`, `webhook.base64 == True`, `groupsIgnore == True`, events из Global Constraints.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement** `provider.py`, `evolution.py` and the config fields.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): Evolution API adapter and webhook parsing`

---

### Task 4: Обработка входящих — лиды, чаты, идемпотентность

**Files:**
- Create: `backend/app/services/whatsapp/inbound.py`, `backend/app/services/whatsapp/media.py`
- Test: `backend/tests/test_whatsapp_inbound.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `handle_events(db: Session, events: list) -> None`. Commit делает вызывающий код.
  - `save_media(message_id: int, data: bytes, file_name: str) -> str` — относительный путь под `WHATSAPP_MEDIA_ROOT` (`whatsapp/<chat_id>/<message_id>_<safe-name>`).
  - `media_abspath(rel: str) -> Path` — отклоняет выход за корень (`..`).
  - `find_lead_for_phone(db, phone) -> tuple[Lead | None, str]` — `(лид, "open" | "won" | "closed" | "none")`.
  - `get_or_create_chat(db, remote_jid: str, phone: str) -> WhatsAppChat`.
- Правила (спек §5.4, «Входящее сообщение»):
  - открытый лид (`status=active`, `stage.kind` не `won`/`lost`) → привязка к нему;
  - только лид в `won` → привязка к нему;
  - только `lost` или архивный → новый лид, в `comment` «Повторное обращение. Предыдущий лид #<id>»;
  - ничего → новый лид: первый активный этап `kind="generic"` по `position`, источник `LeadSource.name == "WhatsApp"` (если нет — `None`), `client_name = push_name or "+"+phone`, `whatsapp = "+"+phone`, без сеттера, `chat.created_lead_id = lead.id`.
  - Если у чата уже есть `lead_id` и этот лид открыт или `won`, новый поиск не делается. Если лид закрыт или архивный, повторяется поиск по правилам выше.
  - `is_ignored` чат → сообщение сохраняется, лид не создаётся.
  - `from_me=True` для неизвестного номера → только чат без лида, `unread_count` не растёт.
  - Входящее (`from_me=False`) → `unread_count += 1`, `last_message_at = sent_at`, `push_name` обновляется.
  - `from_me=True` → `direction="out"`, `sender_user_id=None`, `status="sent"`.
  - Повтор `external_id` → ничего не меняется.
  - `StatusUpdate` → обновить `status` сообщения с этим `external_id`; `read` не понижается до `delivered`.
  - `ConnectionUpdate` → `WhatsAppState.state` и `updated_at`.
  - Медиа из `media_b64` декодируется и сохраняется через `save_media`, а ошибка декодирования не теряет текст сообщения.

- [ ] **Step 1: Write the failing tests** (события строятся через dataclass-конструкторы из Task 3):
  - `test_new_number_creates_unassigned_lead` — этап «Новый лид», источник «WhatsApp», `setter_id is None`, `unread_count == 1`, `created_lead_id == lead.id`.
  - `test_duplicate_event_is_idempotent` — то же событие дважды → одно сообщение, один лид, `unread_count == 1`.
  - `test_existing_lead_matched_by_local_format` — лид с `phone="0700 123 456"` получает сообщение от `996700123456`, новый лид не создаётся.
  - `test_won_lead_gets_message_no_new_lead`.
  - `test_lost_lead_creates_new_with_reference` — comment содержит `#<old id>`.
  - `test_ignored_chat_creates_no_lead`.
  - `test_from_me_unknown_number_creates_chat_only`.
  - `test_status_update_does_not_downgrade_read`.
  - `test_connection_update_stored`.
  - `test_image_saved_outside_public_media` — путь лежит под `WHATSAPP_MEDIA_ROOT` (через monkeypatch во временный каталог), файл существует, `media_abspath("../x")` → `ValueError`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the file, then the full suite. Expected: green.
- [ ] **Step 5: Commit** `feat(whatsapp): inbound processing — lead matching, chats, idempotency`

---

### Task 5: Вебхук и подключение номера (admin API)

**Files:**
- Create: `backend/app/services/whatsapp/runtime.py`, `backend/app/routers/whatsapp.py`
- Modify: `backend/app/main.py` (router; в `lifespan` при настроенном `EVOLUTION_URL` — фоновая задача раз в 60 с: `provider.state()` → `WhatsAppState`, ошибки логируются и не роняют приложение)
- Test: `backend/tests/test_whatsapp_api_admin.py`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `get_provider() -> WhatsAppProvider | None` — FastAPI-зависимость (в тестах подменяется через `app.dependency_overrides` на `FakeProvider`, который тоже лежит в тестах). `None`, если `EVOLUTION_URL` пуст.
  - `POST /api/whatsapp/webhook/{secret}` — без авторизации. Пустой `WHATSAPP_WEBHOOK_SECRET` или несовпадение (`hmac.compare_digest`) → 404. Иначе `parse_webhook` → `handle_events` → commit → `{"ok": true}`. Ошибка разбора → 200 с `{"ok": false}` плюс лог, чтобы Evolution не ретраил бесконечно.
  - `GET /api/whatsapp/status` (admin) → `{configured: bool, state: str, updated_at: datetime | None}`.
  - `POST /api/whatsapp/connect` (admin) → `ensure_instance(f"{WHATSAPP_WEBHOOK_BASE}/api/whatsapp/webhook/{secret}")`, затем `connect()` → `{state, qr_base64, pairing_code}`. Без провайдера → 503 «WhatsApp не настроен».
  - `POST /api/whatsapp/logout` (admin) → `{state: "close"}`.

- [ ] **Step 1: Write the failing tests:**
  - `test_webhook_wrong_or_missing_secret_404` — при пустом секрете в настройках любой путь даёт 404, и при неверном секрете тоже. В базе ничего не создано.
  - `test_webhook_creates_lead` — фикстура `upsert_text.json` → 200, лид создан.
  - `test_webhook_garbage_returns_ok_false`.
  - `test_status_requires_admin` — staff → 403.
  - `test_connect_returns_qr_and_registers_webhook` — `FakeProvider.ensure_instance` получил URL с секретом.
  - `test_connect_without_provider_503`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the file and the full suite. Expected: green.
- [ ] **Step 5: Commit** `feat(whatsapp): webhook endpoint and number connection API`

---

### Task 6: API чата — переписка, отправка, файлы, «Взять себе», «Не лид»

**Files:**
- Create: `backend/app/services/whatsapp/access.py`
- Modify: `backend/app/routers/whatsapp.py`, `backend/app/routers/leads.py` (`LeadDetailOut.whatsapp_chat_id: int | None`)
- Test: `backend/tests/test_whatsapp_api_chat.py`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `can_use_whatsapp(db: Session, user: User) -> bool` (правило — в Global Constraints).
  - `ChatOut {id, phone, push_name, lead_id, is_ignored, unread_count, last_message_at}`.
  - `MessageOut {id, direction, kind, body, status, error, sent_at, sender: UserOut | None, has_media: bool, media_name, media_mime}`.
  - `GET /api/whatsapp/leads/{lead_id}/messages?after_id=` → `{chat: ChatOut | None, messages: list[MessageOut]}` по `sent_at, id`, не больше 200 последних (с `after_id` — только новее). Обнуляет `unread_count`.
  - `POST /api/whatsapp/leads/{lead_id}/messages` `{text: str (1..4096)}` → `MessageOut`. Номер берётся из чата лида, иначе `whatsapp_digits`, иначе `phone_digits`; если номера нет — 422. Сначала создаётся сообщение `pending`, затем `send_text`. При успехе — `sent` + `external_id`, при `ProviderError` — `failed` + `error`, а ответ 502 с текстом «Не удалось отправить: …». Если у лида нет сеттера, отправивший становится сеттером.
  - `POST /api/whatsapp/leads/{lead_id}/media` (multipart: `file`, `caption`) — то же для файла. Размер больше `WHATSAPP_MAX_UPLOAD_BYTES` → 413. `mediatype`: `image/*→image`, `video/*→video`, `audio/*→audio`, иначе `document`.
  - `GET /api/whatsapp/media/{message_id}` → `FileResponse` (`media_type=media_mime`, `filename=media_name`). Без прав — 403, файла нет — 404.
  - `POST /api/whatsapp/leads/{lead_id}/take` → назначает себя сеттером. Если сеттер уже есть (другой человек) — 409.
  - `POST /api/whatsapp/chats/{chat_id}/ignore` → `is_ignored=True`; если `lead_id == created_lead_id`, этот лид архивируется.
  - `POST /api/whatsapp/chats/{chat_id}/unignore`.
  - `POST /api/whatsapp/chats/{chat_id}/make-lead` → для чата без лида создаётся лид по правилам Task 4.
  - `GET /api/whatsapp/chats/other` → чаты, где `lead_id IS NULL` или `is_ignored`, по `last_message_at desc`.
  - `GET /api/whatsapp/access` → `{can_use: bool}` для текущего пользователя (без 403).
  - Все остальные эндпоинты, кроме вебхука, — `can_use_whatsapp`, иначе 403.

- [ ] **Step 1: Write the failing tests** (через `FakeProvider` из Task 5):
  - `test_staff_outside_sales_forbidden` — 403 на получение сообщений и на файл.
  - `test_unauthenticated_media_401`.
  - `test_get_messages_marks_read`.
  - `test_send_text_success_sets_sender_and_setter`.
  - `test_send_text_provider_down_marks_failed` — 502, сообщение `failed` с `error`.
  - `test_send_without_any_number_422`.
  - `test_media_upload_too_large_413` (через monkeypatch лимита до 10 байт).
  - `test_take_conflict_409`.
  - `test_ignore_archives_only_auto_created_lead` — лид, созданный вручную, не архивируется.
  - `test_other_chats_lists_unlinked_and_ignored`.
  - `test_make_lead_from_unlinked_chat`.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the file and the full suite. Expected: green.
- [ ] **Step 5: Commit** `feat(whatsapp): chat API — messages, send, media, take, ignore`

---

### Task 7: Доска и колокольчик

**Files:**
- Modify: `backend/app/services/lead_board.py`, `backend/app/routers/lead_board.py`, `backend/app/routers/notifications.py`
- Test: `backend/tests/test_whatsapp_board_notifications.py`

**Interfaces:**
- Consumes: Tasks 2, 6.
- Produces:
  - `board_sort_key(lead: Lead, unread: int = 0) -> tuple` — сначала непрочитанные, затем как раньше: `(0 if unread else 1, -ts, -id)`.
  - `CardOut.whatsapp_unread: int = 0` — одним запросом по `whatsapp_chats` для лидов на доске.
  - `notifications.py`:
    - `_is_sales` → `can_use_whatsapp`;
    - для них живая строка `wa_unassigned`: «N неразобранных заявок из WhatsApp» (активные лиды без сеттера, у которых есть чат с `is_ignored=False`), ссылка `/leads/board?unassigned=true`, только при N > 0;
    - `wa_client_wrote_<lead_id>`: «Клиент написал: <имя>» — лиды в `won`, где пользователь сеттер или клоузер, а у чата `unread_count > 0`;
    - для admin: `wa_disconnected` с severity `danger` «WhatsApp отключён — заявки не принимаются», если настроен `EVOLUTION_URL` и `WhatsAppState.state != "open"`, ссылка `/admin/whatsapp`.

- [ ] **Step 1: Write the failing tests:**
  - `test_unread_cards_first` — лид с непрочитанным идёт раньше более свежего.
  - `test_card_has_unread_count`.
  - `test_unassigned_notification_for_sales_only` — сотрудник отдела продаж видит строку, промптер нет.
  - `test_client_wrote_for_won_lead_owner`.
  - `test_disconnected_alert_for_admin` — через monkeypatch `settings.EVOLUTION_URL`. При `state="open"` строки нет.
- [ ] **Step 2: Run**. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** the file and the full suite. Expected: green.
- [ ] **Step 5: Commit** `feat(whatsapp): unread on board cards and sales notifications`

---

### Task 8: Фронтенд — чат в карточке, подключение номера, доска

**Files:**
- Create: `frontend/src/lib/whatsapp.ts`, `frontend/src/lib/whatsapp.test.ts`, `frontend/src/components/whatsapp/LeadWhatsAppChat.tsx`, `frontend/src/app/admin/whatsapp/page.tsx`
- Modify: `frontend/src/lib/api.ts` (`whatsappApi`), `frontend/src/lib/types.ts` (`WhatsAppChat`, `WhatsAppMessage`, `WhatsAppStatus`, `LeadBoardCard.whatsapp_unread`, `LeadDetail.whatsapp_chat_id`), `frontend/src/app/leads/[id]/page.tsx` (блок «WhatsApp», кнопки «Взять себе» и «Не лид»), `frontend/src/components/leads/LeadBoard.tsx` (бейдж `💬 N`, кнопка «Взять себе» при пустом сеттере), `frontend/src/components/Shell.tsx` (пункт «WhatsApp» в админ-меню)

**Interfaces:**
- Consumes: эндпоинты Tasks 5–7.
- Produces (`lib/whatsapp.ts`):
  - `mergeMessages(current: WhatsAppMessage[], incoming: WhatsAppMessage[]): WhatsAppMessage[]` — без дублей по `id`, у пришедшей версии приоритет (статус обновляется), сортировка по `sent_at`, затем `id`.
  - `statusLabel(m: WhatsAppMessage): string` — `pending`→«Отправляется», `sent`→«Отправлено», `delivered`→«Доставлено», `read`→«Прочитано», `failed`→«Ошибка», `received`→"".
  - `mediaKindFor(mime: string): "image" | "video" | "audio" | "document"`.

- [ ] **Step 1: Write the failing tests** `whatsapp.test.ts`:
  - `mergeMessages` убирает дубль и берёт новую версию статуса;
  - сортирует по времени;
  - `statusLabel` для всех шести статусов;
  - `mediaKindFor("image/png") === "image"`, `"application/pdf"` → `"document"`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/whatsapp.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/whatsapp.ts`.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Implement the UI:**
  - `LeadWhatsAppChat` (props `leadId`, `canUse`):
    - пузыри входящих слева и исходящих справа; у исходящих — имя отправителя или «с телефона» и `statusLabel`;
    - изображения через `fetch` с токеном → `URL.createObjectURL` (и `revokeObjectURL` при размонтировании), остальные файлы — кнопка «Скачать»;
    - поле ввода (Enter — отправить, Shift+Enter — перенос) и кнопка выбора файла;
    - ошибка отправки показывается под полем, а сообщение остаётся в ленте со статусом «Ошибка»;
    - опрос `after_id` каждые 5000 мс только при `document.visibilityState === "visible"`.
  - Страница лида: блок показывается, если `whatsappApi.access()` вернул `can_use` (правило живёт только на бэкенде). Кнопка «Взять себе» видна, если сеттера нет. «Не лид» — с подтверждением.
  - `/admin/whatsapp`: статус (Подключён / Подключается / Отключён / Не настроено), «Подключить» → QR (`<img src={qr_base64}>`) и код сопряжения, обновление статуса каждые 3 с, пока не `open`; «Отключить» с подтверждением; список «Прочие чаты» с действиями «Вернуть» и «Сделать лидом».
  - Доска: бейдж непрочитанных; «Взять себе» на карточке без сеттера.
- [ ] **Step 6: Run** `cd frontend && npm test && npx tsc --noEmit -p . && npm run build`. Expected: green.
- [ ] **Step 7: Commit** `feat(whatsapp): chat in lead card, number connection page, unread on board`

---

### Task 9: Инфраструктура и документация

**Files:**
- Modify: `docker-compose.yml`, `docker-compose.tunnel.yml` (если нужно — сеть `default` у `evolution`), `.env.example`, `nginx/nginx.conf`, `nginx/nginx.tunnel.conf`, `DEPLOY.md`, `README.md`, `docs/product-spec.md`
- Create: `docker-compose.whatsapp-dev.yml`

- [ ] **Step 1: Confirm the image tag:** `docker pull evoapicloud/evolution-api:v2.3.7` (если такого тега нет — `docker pull evoapicloud/evolution-api:2.3.7`). Записать в ledger, какой тег сработал.
- [ ] **Step 2: Compose service `evolution`:**
  - `image` с подтверждённым тегом, `restart: unless-stopped`, `depends_on: db (service_healthy)`, без `ports`, `expose: ["8080"]`;
  - env: `SERVER_URL=http://evolution:8080`, `AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}`, `DATABASE_PROVIDER=postgresql`, `DATABASE_CONNECTION_URI=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}?schema=evolution`, `DATABASE_CONNECTION_CLIENT_NAME=evolution`, `CACHE_REDIS_ENABLED=false`, `CACHE_LOCAL_ENABLED=true`, `DEL_INSTANCE=false`, `LANGUAGE=ru`, `CONFIG_SESSION_PHONE_CLIENT=Espada`, `QRCODE_LIMIT=30`, `SERVER_DISABLE_MANAGER=true`, `SERVER_DISABLE_DOCS=true`;
  - том `evolution_instances:/evolution/instances`.

  У `backend`: env `EVOLUTION_URL=http://evolution:8080`, `EVOLUTION_API_KEY`, `WHATSAPP_INSTANCE`, `WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_WEBHOOK_BASE=http://backend:8000`, `WHATSAPP_MEDIA_ROOT=/app/whatsapp_media`, том `whatsapp_media:/app/whatsapp_media`.
- [ ] **Step 3: nginx (оба конфига):** `location /api/whatsapp/webhook/ { return 404; }` до `location /api/`. Лимит `client_max_body_size 20m` для `/api/whatsapp/`.
- [ ] **Step 4: `.env.example`** — `EVOLUTION_API_KEY=` (сгенерировать `openssl rand -hex 32`), `WHATSAPP_WEBHOOK_SECRET=` (то же), `WHATSAPP_INSTANCE=espada-sales`.
- [ ] **Step 5: `docker-compose.whatsapp-dev.yml`** — только `postgres:16-alpine` (порт `55432`) и `evolution` (порт `8088:8080` на `127.0.0.1`). Вебхук-база для локального бэкенда — `http://host.docker.internal:8001`.
- [ ] **Step 6: Verify locally:**
  - `docker compose -f docker-compose.whatsapp-dev.yml up -d`;
  - `curl -s -H "apikey: …" http://127.0.0.1:8088/instance/fetchInstances` → `[]`;
  - в логах Evolution видно, что схема `evolution` создана (prisma migrate) и сервис слушает 8080.
- [ ] **Step 7: Docs:**
  - DEPLOY.md, раздел «WhatsApp (часть 4)»:
    - переменные окружения;
    - `docker compose up -d --build`;
    - «Админ → WhatsApp → Подключить → отсканировать QR с телефона отдела»;
    - **не подключать номер отдела к локальной среде**;
    - что делать при отключении;
    - бэкапы: `pg_dump` теперь включает схему `evolution`, а тома `evolution_instances` и `whatsapp_media` бэкапить отдельно;
    - предупреждение о риске блокировки и запрете рассылок.
  - README: раздел WhatsApp и статус тестов.
  - product-spec: модуль WhatsApp, API, права.
- [ ] **Step 8: Commit** `feat(whatsapp): Evolution service in compose, nginx guard, deploy docs`

---

### Task 10: Проверка на тестовом номере (с пользователем)

Нужен телефон с **тестовым** номером WhatsApp. Номер отдела не использовать.

- [ ] **Step 1:** Поднять `docker-compose.whatsapp-dev.yml` и локальный бэкенд и фронтенд с `EVOLUTION_URL=http://127.0.0.1:8088`, `WHATSAPP_WEBHOOK_BASE=http://host.docker.internal:8001` и секретами из `.claude/launch.json`.
- [ ] **Step 2:** `/admin/whatsapp` → «Подключить» → пользователь сканирует QR тестовым телефоном → статус «Подключён».
- [ ] **Step 3:** С другого телефона написать на тестовый номер → в течение 5 секунд появляется лид «Новый лид» с источником WhatsApp и сообщением в чате карточки, а на доске — бейдж и «Неразобранные».
- [ ] **Step 4:** Ответить из карточки текстом и картинкой → на телефоне пришло, статус дошёл до «Доставлено» или «Прочитано».
- [ ] **Step 5:** Ответить с самого тестового телефона → сообщение видно в карточке с пометкой «с телефона».
- [ ] **Step 6:** «Не лид» → лид архивирован, новое сообщение с того же номера лид не создаёт и видно в «Прочих чатах».
- [ ] **Step 7:** Отключить номер (выйти на телефоне из связанных устройств) → у админа в колокольчике «WhatsApp отключён».
- [ ] **Step 8:** Ledger: что проверено и что нет.

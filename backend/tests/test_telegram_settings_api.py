from datetime import datetime, timezone

import pytest

from app.core.security import hash_password
from app.main import app
from app.models import Role, TelegramSettings, User
from app.routers.telegram_settings import get_telegram_client_factory
from app.services.telegram.client import TelegramError
from tests.conftest import auth_headers

BASE = "/api/sales-hub/telegram"
TOK = "123:" + "A" * 30 + "EFGH"
TOK2 = "999:" + "Z" * 30 + "YYYY"
BAD = "1:" + "b" * 30


class FakeTg:
    def __init__(self, token, state):
        self.token = token
        self.state = state

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def get_me(self):
        if self.token == BAD:
            raise TelegramError("Токен не подошёл")
        return "espada_bot"

    def find_groups(self):
        return [{"id": "-100500", "title": "Продажи"}]

    def send_message(self, chat_id, text):
        if self.state.get("fail"):
            raise TelegramError("Бот не в группе")
        self.state.setdefault("sent", []).append((chat_id, text))


@pytest.fixture()
def tg(client):
    state = {}
    app.dependency_overrides[get_telegram_client_factory] = lambda: (lambda token: FakeTg(token, state))
    yield state
    app.dependency_overrides.pop(get_telegram_client_factory, None)


@pytest.fixture()
def head(db):
    u = User(name="РОП", email="rop@test.kg", password_hash=hash_password("x"),
             role=Role.staff, position="Руководитель продаж", is_active=True)
    db.add(u)
    db.commit()
    return u


def test_staff_forbidden(client, tg, staff):
    assert client.get(BASE, headers=auth_headers(staff)).status_code == 403


def test_save_token_validates_and_masks(client, tg, head):
    h = auth_headers(head)
    r = client.put(f"{BASE}/token", json={"token": TOK}, headers=h)
    assert r.status_code == 200
    assert r.json()["token_tail"] == "EFGH"
    assert r.json()["bot_username"] == "espada_bot"
    assert TOK not in r.text
    assert TOK not in client.get(BASE, headers=h).text
    r = client.put(f"{BASE}/token", json={"token": BAD}, headers=h)
    assert r.status_code == 422
    assert "Токен не подошёл" in r.text


def test_new_bot_resets_group(client, tg, head, db):
    h = auth_headers(head)
    client.put(f"{BASE}/token", json={"token": TOK}, headers=h)
    client.put(BASE, json={"chat_id": "-100500", "chat_title": "Продажи"}, headers=h)
    client.put(BASE, json={"enabled": True}, headers=h)
    cfg = db.get(TelegramSettings, 1)
    cfg.last_error, cfg.last_error_at = "старая ошибка", datetime.now(timezone.utc)
    db.commit()
    r = client.put(f"{BASE}/token", json={"token": TOK}, headers=h)
    assert r.json()["chat_id"] == "-100500"
    r = client.put(f"{BASE}/token", json={"token": TOK2}, headers=h)
    assert r.json()["chat_id"] == ""
    assert r.json()["chat_title"] == ""
    assert r.json()["enabled"] is False
    assert r.json()["last_error"] == ""


def test_find_groups_and_select(client, tg, head):
    h = auth_headers(head)
    assert client.post(f"{BASE}/groups", headers=h).status_code == 422
    client.put(f"{BASE}/token", json={"token": TOK}, headers=h)
    r = client.post(f"{BASE}/groups", headers=h)
    assert r.json() == [{"id": "-100500", "title": "Продажи"}]
    r = client.put(BASE, json={"chat_id": "-100500", "chat_title": "Продажи"}, headers=h)
    assert r.json()["chat_id"] == "-100500"
    assert r.json()["chat_title"] == "Продажи"


def test_enable_requires_setup(client, tg, head):
    h = auth_headers(head)
    r = client.put(BASE, json={"enabled": True}, headers=h)
    assert r.status_code == 422
    assert "Сначала подключите бота и выберите группу" in r.text
    client.put(f"{BASE}/token", json={"token": TOK}, headers=h)
    client.put(BASE, json={"chat_id": "-100500", "chat_title": "Продажи"}, headers=h)
    assert client.put(BASE, json={"enabled": True}, headers=h).json()["enabled"] is True


def test_send_test_message(client, tg, head):
    h = auth_headers(head)
    client.put(f"{BASE}/token", json={"token": TOK}, headers=h)
    client.put(BASE, json={"chat_id": "-100500", "chat_title": "Продажи"}, headers=h)
    assert client.post(f"{BASE}/test", headers=h).status_code == 200
    assert tg["sent"][0][0] == "-100500"
    tg["fail"] = True
    r = client.post(f"{BASE}/test", headers=h)
    assert r.status_code == 422
    assert "Бот не в группе" in r.text


def test_closer_username_normalized(client, tg, head, other_staff, staff, db):
    h = auth_headers(head)
    other_staff.is_closer = True
    db.commit()
    r = client.put(f"{BASE}/closers/{other_staff.id}", json={"telegram_username": " @Adahan_1 "}, headers=h)
    assert r.status_code == 200
    db.refresh(other_staff)
    assert other_staff.telegram_username == "Adahan_1"
    assert client.put(f"{BASE}/closers/{other_staff.id}", json={"telegram_username": "ab"}, headers=h).status_code == 422
    assert client.put(f"{BASE}/closers/{staff.id}", json={"telegram_username": "Adahan_1"}, headers=h).status_code == 404
    g = client.get(BASE, headers=h).json()
    assert g["closers"] == [{"id": other_staff.id, "name": "Другой", "telegram_username": "Adahan_1"}]


def test_token_format_validated(client, tg, head):
    h = auth_headers(head)
    r = client.put(f"{BASE}/token", json={"token": "hello world"}, headers=h)
    assert r.status_code == 422
    assert "Это не похоже на токен бота — скопируйте его из @BotFather" in r.text
    good = "123456:" + "A" * 35
    assert client.put(f"{BASE}/token", json={"token": f"  {good}  "}, headers=h).status_code == 200


def test_send_test_clears_last_error(client, tg, head, db):
    h = auth_headers(head)
    client.put(f"{BASE}/token", json={"token": TOK}, headers=h)
    client.put(BASE, json={"chat_id": "-100500", "chat_title": "Продажи"}, headers=h)
    cfg = db.get(TelegramSettings, 1)
    cfg.last_error, cfg.last_error_at = "ошибка", datetime.now(timezone.utc)
    db.commit()
    assert client.post(f"{BASE}/test", headers=h).status_code == 200
    db.expire_all()
    cfg = db.get(TelegramSettings, 1)
    assert cfg.last_error == "" and cfg.last_error_at is None


def test_settings_length_limits(client, tg, head):
    h = auth_headers(head)
    assert client.put(BASE, json={"chat_id": "1" * 33}, headers=h).status_code == 422
    assert client.put(BASE, json={"chat_title": "x" * 201}, headers=h).status_code == 422

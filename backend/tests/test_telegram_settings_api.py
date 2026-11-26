import pytest

from app.core.security import hash_password
from app.main import app
from app.models import Role, TelegramSettings, User
from app.routers.telegram_settings import get_telegram_client_factory
from app.services.telegram.client import TelegramError
from tests.conftest import auth_headers

BASE = "/api/sales-hub/telegram"


class FakeTg:
    def __init__(self, token, state):
        self.token = token
        self.state = state

    def get_me(self):
        if self.token == "bad":
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
    r = client.put(f"{BASE}/token", json={"token": "123:ABCDEFGH"}, headers=h)
    assert r.status_code == 200
    assert r.json()["token_tail"] == "EFGH"
    assert r.json()["bot_username"] == "espada_bot"
    assert "123:ABCDEFGH" not in r.text
    assert "123:ABCDEFGH" not in client.get(BASE, headers=h).text
    r = client.put(f"{BASE}/token", json={"token": "bad"}, headers=h)
    assert r.status_code == 422
    assert "Токен не подошёл" in r.text


def test_new_bot_resets_group(client, tg, head, db):
    h = auth_headers(head)
    client.put(f"{BASE}/token", json={"token": "123:ABCDEFGH"}, headers=h)
    client.put(BASE, json={"chat_id": "-100500", "chat_title": "Продажи"}, headers=h)
    r = client.put(f"{BASE}/token", json={"token": "123:ABCDEFGH"}, headers=h)
    assert r.json()["chat_id"] == "-100500"
    r = client.put(f"{BASE}/token", json={"token": "999:ZZZZYYYY"}, headers=h)
    assert r.json()["chat_id"] == ""
    assert r.json()["chat_title"] == ""


def test_find_groups_and_select(client, tg, head):
    h = auth_headers(head)
    assert client.post(f"{BASE}/groups", headers=h).status_code == 422
    client.put(f"{BASE}/token", json={"token": "123:ABCDEFGH"}, headers=h)
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
    client.put(f"{BASE}/token", json={"token": "123:ABCDEFGH"}, headers=h)
    client.put(BASE, json={"chat_id": "-100500", "chat_title": "Продажи"}, headers=h)
    assert client.put(BASE, json={"enabled": True}, headers=h).json()["enabled"] is True


def test_send_test_message(client, tg, head):
    h = auth_headers(head)
    client.put(f"{BASE}/token", json={"token": "123:ABCDEFGH"}, headers=h)
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

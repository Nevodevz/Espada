import json

import httpx
import pytest

from app.services.telegram.client import TelegramClient, TelegramError


def make(handler) -> TelegramClient:
    return TelegramClient("123:abc", http=httpx.Client(transport=httpx.MockTransport(handler)))


def test_get_me_returns_username():
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        return httpx.Response(200, json={"ok": True, "result": {"username": "espada_bot"}})

    assert make(handler).get_me() == "espada_bot"
    assert seen["path"] == "/bot123:abc/getMe"


def test_bad_token_raises():
    def handler(request):
        return httpx.Response(401, json={"ok": False, "description": "Unauthorized"})

    with pytest.raises(TelegramError, match="Токен не подошёл"):
        make(handler).get_me()


def test_find_groups_dedups_and_skips_private():
    def handler(request):
        return httpx.Response(200, json={"ok": True, "result": [
            {"update_id": 1, "message": {"chat": {"id": -100123, "title": "Отдел продаж", "type": "supergroup"}}},
            {"update_id": 2, "message": {"chat": {"id": 55, "first_name": "Ivan", "type": "private"}}},
            {"update_id": 3, "message": {"chat": {"id": -100123, "title": "Отдел продаж", "type": "supergroup"}}},
            {"update_id": 4, "my_chat_member": {"chat": {"id": -42, "title": "Тест", "type": "group"}}},
        ]})

    assert make(handler).find_groups() == [
        {"id": "-100123", "title": "Отдел продаж"}, {"id": "-42", "title": "Тест"},
    ]


def test_send_message_posts_html():
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "result": {}})

    make(handler).send_message("-100123", "x")
    assert seen["path"] == "/bot123:abc/sendMessage"
    assert seen["body"] == {"chat_id": "-100123", "text": "x", "parse_mode": "HTML",
                            "disable_web_page_preview": True}


def test_network_error_raises():
    def handler(request):
        raise httpx.ConnectError("failed https://api.telegram.org/bot123:abc/getMe")

    with pytest.raises(TelegramError) as info:
        make(handler).get_me()
    assert "123:abc" not in str(info.value)


def test_close_closes_http_client():
    http = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True})))
    TelegramClient("123:abc", http=http).close()
    assert http.is_closed

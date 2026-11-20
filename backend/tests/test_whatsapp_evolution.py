"""Evolution API v2.3.7 adapter: webhook parsing and HTTP calls (no network)."""
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from app.services.whatsapp.evolution import EvolutionProvider, parse_webhook
from app.services.whatsapp.provider import (
    ConnectionUpdate, InboundMessage, ProviderError, SendResult, StatusUpdate,
)

FIX = Path(__file__).parent / "fixtures" / "evolution"


def fixture(name):
    return json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))


def test_parse_text_message():
    [m] = parse_webhook(fixture("upsert_text"))
    assert isinstance(m, InboundMessage)
    assert (m.external_id, m.phone, m.from_me, m.push_name, m.kind) == ("3EB0A1", "996700123456", False, "Асель", "text")
    assert m.body == "Здравствуйте, сколько стоит бот?"
    assert m.remote_jid == "996700123456@s.whatsapp.net"
    assert m.sent_at == datetime.fromtimestamp(1795600000, tz=timezone.utc)
    assert m.media_b64 is None


def test_parse_image_with_base64():
    [m] = parse_webhook(fixture("upsert_image_base64"))
    assert (m.kind, m.media_b64, m.media_mime, m.body) == ("image", "aGVsbG8=", "image/jpeg", "Вот наш прайс")


def test_parse_document_keeps_file_name():
    [m] = parse_webhook(fixture("upsert_document"))
    assert (m.kind, m.media_name, m.media_mime) == ("document", "ТЗ.pdf", "application/pdf")


@pytest.mark.parametrize("name", ["upsert_group", "upsert_broadcast", "upsert_reaction"])
def test_ignored_payloads(name):
    assert parse_webhook(fixture(name)) == []


def test_lid_uses_remote_jid_alt():
    [m] = parse_webhook(fixture("upsert_lid"))
    assert m.phone == "996700123456" and m.remote_jid == "996700123456@s.whatsapp.net"
    payload = fixture("upsert_lid")
    del payload["data"]["key"]["remoteJidAlt"]
    assert parse_webhook(payload) == []


def test_from_me_kept():
    [m] = parse_webhook(fixture("upsert_from_me"))
    assert m.from_me is True and m.body == "Добрый день! Отправлю КП"


def test_status_update_mapped():
    assert parse_webhook(fixture("update_read")) == [StatusUpdate(external_id="OUT1", status="read")]


def test_connection_update():
    assert parse_webhook(fixture("connection_open")) == [ConnectionUpdate(state="open")]


@pytest.mark.parametrize("payload", [{}, {"event": "messages.upsert"}, {"event": "chats.upsert", "data": []}, "x"])
def test_garbage_and_unknown_events_ignored(payload):
    assert parse_webhook(payload) == []


# ── HTTP ─────────────────────────────────────────────────────────

def provider(handler):
    client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://evo:8080")
    return EvolutionProvider("http://evo:8080", "secret-key", "espada-sales", client=client)


def test_send_text_posts_number_and_apikey():
    seen = {}

    def handler(request: httpx.Request):
        seen["path"] = request.url.path
        seen["apikey"] = request.headers.get("apikey")
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json={"key": {"id": "ABC"}})

    result = provider(handler).send_text("996700123456", "Здравствуйте")
    assert result == SendResult(external_id="ABC")
    assert seen == {"path": "/message/sendText/espada-sales", "apikey": "secret-key",
                    "body": {"number": "996700123456", "text": "Здравствуйте"}}


def test_send_media_posts_base64():
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json={"key": {"id": "MED"}})

    result = provider(handler).send_media("996700123456", b"hello", "application/pdf", "КП.pdf", "Наше КП")
    assert result.external_id == "MED"
    assert seen["path"] == "/message/sendMedia/espada-sales"
    assert seen["body"] == {"number": "996700123456", "mediatype": "document", "mimetype": "application/pdf",
                            "caption": "Наше КП", "media": "aGVsbG8=", "fileName": "КП.pdf"}


def test_http_error_raises_provider_error():
    with pytest.raises(ProviderError):
        provider(lambda r: httpx.Response(500, json={"error": "boom"})).send_text("1", "x")

    def down(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderError):
        provider(down).send_text("1", "x")


def test_connect_returns_qr_when_not_open():
    p = provider(lambda r: httpx.Response(200, json={"base64": "data:image/png;base64,xx", "pairingCode": "AB12", "code": "2@..", "count": 1}))
    assert p.connect() == {"state": "connecting", "qr_base64": "data:image/png;base64,xx", "pairing_code": "AB12"}


def test_connect_when_already_open():
    p = provider(lambda r: httpx.Response(200, json={"instance": {"instanceName": "espada-sales", "state": "open"}}))
    assert p.connect() == {"state": "open", "qr_base64": None, "pairing_code": None}


def test_state_reads_connection_state():
    p = provider(lambda r: httpx.Response(200, json={"instance": {"instanceName": "espada-sales", "state": "close"}}))
    assert p.state() == "close"


def test_ensure_instance_creates_when_missing():
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path, json.loads(request.content) if request.content else None))
        if request.url.path.startswith("/instance/connectionState"):
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(201, json={"instance": {"instanceName": "espada-sales"}})

    provider(handler).ensure_instance("http://backend:8000/api/whatsapp/webhook/s3cr3t")
    method, path, body = calls[-1]
    assert (method, path) == ("POST", "/instance/create")
    assert body["instanceName"] == "espada-sales" and body["integration"] == "WHATSAPP-BAILEYS"
    assert body["groupsIgnore"] is True and body["qrcode"] is True
    hook = body["webhook"]
    assert hook["url"].endswith("/s3cr3t") and hook["base64"] is True and hook["byEvents"] is False and hook["enabled"] is True
    assert set(hook["events"]) == {"MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"}


def test_ensure_instance_updates_webhook_when_present():
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path))
        if request.url.path.startswith("/instance/connectionState"):
            return httpx.Response(200, json={"instance": {"state": "close"}})
        return httpx.Response(201, json={})

    provider(handler).ensure_instance("http://backend:8000/api/whatsapp/webhook/s")
    assert calls[-1] == ("POST", "/webhook/set/espada-sales")

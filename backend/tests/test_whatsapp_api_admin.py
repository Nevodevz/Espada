"""Webhook endpoint and number-connection API."""
import json
from pathlib import Path

import pytest

from app.core.config import settings
from app.main import app
from app.models import Lead, LeadSource, WhatsAppState
from app.services.whatsapp.runtime import get_provider
from tests.conftest import auth_headers
from tests.whatsapp_fakes import FakeProvider

FIX = Path(__file__).parent / "fixtures" / "evolution"
SECRET = "s3cr3t-webhook"


@pytest.fixture()
def fake(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "WHATSAPP_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(settings, "WHATSAPP_WEBHOOK_BASE", "http://backend:8000")
    monkeypatch.setattr(settings, "WHATSAPP_MEDIA_ROOT", str(tmp_path / "wa"))
    provider = FakeProvider()
    app.dependency_overrides[get_provider] = lambda: provider
    yield provider
    app.dependency_overrides.pop(get_provider, None)


def payload(name):
    return json.loads((FIX / f"{name}.json").read_text(encoding="utf-8"))


def test_webhook_wrong_or_missing_secret_404(client, db, stages, fake, monkeypatch):
    assert client.post("/api/whatsapp/webhook/wrong", json=payload("upsert_text")).status_code == 404
    monkeypatch.setattr(settings, "WHATSAPP_WEBHOOK_SECRET", "")
    assert client.post("/api/whatsapp/webhook/", json=payload("upsert_text")).status_code in (404, 405)
    assert client.post("/api/whatsapp/webhook/anything", json=payload("upsert_text")).status_code == 404
    assert db.query(Lead).count() == 0


def test_webhook_creates_lead(client, db, stages, fake):
    db.add(LeadSource(name="WhatsApp", position=0))
    db.commit()
    r = client.post(f"/api/whatsapp/webhook/{SECRET}", json=payload("upsert_text"))
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert db.query(Lead).one().client_name == "Асель"


def test_webhook_connection_update_stored(client, db, fake):
    client.post(f"/api/whatsapp/webhook/{SECRET}", json=payload("connection_open"))
    assert db.get(WhatsAppState, 1).state == "open"


def test_webhook_garbage_returns_ok_false(client, fake):
    r = client.post(f"/api/whatsapp/webhook/{SECRET}", content=b"not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 200 and r.json() == {"ok": False}


def test_status_requires_admin(client, staff, fake):
    assert client.get("/api/whatsapp/status", headers=auth_headers(staff)).status_code == 403


def test_status_for_admin(client, db, admin, fake, monkeypatch):
    monkeypatch.setattr(settings, "EVOLUTION_URL", "http://evolution:8080")
    monkeypatch.setattr(settings, "EVOLUTION_API_KEY", "k")
    db.add(WhatsAppState(id=1, state="open"))
    db.commit()
    body = client.get("/api/whatsapp/status", headers=auth_headers(admin)).json()
    assert body["configured"] is True and body["state"] == "open"


def test_connect_returns_qr_and_registers_webhook(client, admin, fake):
    r = client.post("/api/whatsapp/connect", headers=auth_headers(admin))
    assert r.status_code == 200
    assert r.json() == {"state": "connecting", "qr_base64": "data:image/png;base64,QR", "pairing_code": "AB12CD34"}
    assert fake.webhook_url == f"http://backend:8000/api/whatsapp/webhook/{SECRET}"


def test_connect_without_provider_503(client, admin):
    app.dependency_overrides[get_provider] = lambda: None
    try:
        r = client.post("/api/whatsapp/connect", headers=auth_headers(admin))
    finally:
        app.dependency_overrides.pop(get_provider, None)
    assert r.status_code == 503 and "не настроен" in r.json()["detail"]


def test_connect_without_webhook_secret_503(client, admin, fake, monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_WEBHOOK_SECRET", "")
    assert client.post("/api/whatsapp/connect", headers=auth_headers(admin)).status_code == 503


def test_logout(client, db, admin, fake):
    fake.current_state = "open"
    r = client.post("/api/whatsapp/logout", headers=auth_headers(admin))
    assert r.status_code == 200 and r.json() == {"state": "close"}
    assert db.get(WhatsAppState, 1).state == "close"


def test_webhook_retries_once_on_integrity_error(client, db, stages, fake, monkeypatch):
    """Two webhooks for a brand-new number race on UNIQUE(remote_jid): the loser retries, nothing is lost."""
    from sqlalchemy.exc import IntegrityError
    from app.services.whatsapp import inbound
    from app.models import WhatsAppMessage
    real = inbound.handle_events
    calls = {"n": 0}

    def flaky(session, events):
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("INSERT", {}, Exception("duplicate remote_jid"))
        return real(session, events)

    monkeypatch.setattr("app.routers.whatsapp.handle_events", flaky)
    r = client.post(f"/api/whatsapp/webhook/{SECRET}", json=payload("upsert_text"))
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert calls["n"] == 2 and db.query(WhatsAppMessage).count() == 1


def test_webhook_infrastructure_error_returns_503(client, db, fake, monkeypatch):
    """A DB/disk failure must not be acknowledged — Evolution retries the delivery."""
    from sqlalchemy.exc import OperationalError

    def broken(session, events):
        raise OperationalError("SELECT", {}, Exception("db down"))

    monkeypatch.setattr("app.routers.whatsapp.handle_events", broken)
    assert client.post(f"/api/whatsapp/webhook/{SECRET}", json=payload("upsert_text")).status_code == 503

"""Unread WhatsApp on board cards and WhatsApp notifications in the bell."""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.core.security import hash_password
from app.models import Department, Lead, LeadStatus, Role, User, WhatsAppChat, WhatsAppState
from tests.conftest import auth_headers


@pytest.fixture()
def sales(db, staff):
    dept = Department(name="Отдел продаж", slug="sales", kind="sales", members=[staff])
    db.add(dept)
    db.commit()
    return dept


@pytest.fixture()
def outsider(db):
    u = User(name="Промптер", email="prompt@test.kg", password_hash=hash_password("x"),
             role=Role.staff, position="Промпт-инженер", is_active=True)
    db.add(u)
    db.commit()
    return u


def chat_for(db, lead, unread=0, ignored=False):
    c = WhatsAppChat(remote_jid=f"{lead.id}00@s.whatsapp.net", phone=f"{lead.id}00", lead_id=lead.id,
                     unread_count=unread, is_ignored=ignored)
    db.add(c)
    db.commit()
    return c


def notif_ids(client, user):
    return {n["id"]: n for n in client.get("/api/notifications", headers=auth_headers(user)).json()["items"]}


def test_unread_cards_first(client, db, admin, stages, lead):
    now = datetime.now(timezone.utc)
    lead.updated_at = now - timedelta(days=5)
    fresh = Lead(client_name="Свежий", phone="+996 700 999999", stage_id=stages["Созвон"].id, status=LeadStatus.active)
    fresh.updated_at = now
    db.add(fresh)
    db.commit()
    chat_for(db, lead, unread=2)
    cards = client.get("/api/lead-board", headers=auth_headers(admin)).json()["leads"]
    assert [c["id"] for c in cards][:2] == [lead.id, fresh.id]


def test_card_has_unread_count(client, db, admin, lead):
    chat_for(db, lead, unread=3)
    card = next(c for c in client.get("/api/lead-board", headers=auth_headers(admin)).json()["leads"] if c["id"] == lead.id)
    assert card["whatsapp_unread"] == 3


def test_unassigned_notification_for_sales_only(client, db, stages, staff, outsider, sales):
    free = Lead(client_name="Ничей", phone="+996 700 555555", stage_id=stages["Новый лид"].id, status=LeadStatus.active)
    db.add(free)
    db.commit()
    chat_for(db, free, unread=1)
    n = notif_ids(client, staff).get("wa_unassigned")
    assert n and "1" in n["title"] and n["link"] == "/leads/board?unassigned=true"
    assert "wa_unassigned" not in notif_ids(client, outsider)


def test_ignored_chat_not_counted_as_unassigned(client, db, stages, staff, sales):
    free = Lead(client_name="Спам", phone="+996 700 555556", stage_id=stages["Новый лид"].id, status=LeadStatus.active)
    db.add(free)
    db.commit()
    chat_for(db, free, ignored=True)
    assert "wa_unassigned" not in notif_ids(client, staff)


def test_client_wrote_for_won_lead_owner(client, db, stages, lead, staff, sales):
    lead.stage_id = stages["Оплачено"].id
    db.commit()
    chat_for(db, lead, unread=1)
    n = notif_ids(client, staff).get(f"wa_client_wrote_{lead.id}")
    assert n and lead.client_name in n["title"]


def test_disconnected_alert_for_admin(client, db, admin, staff, sales, monkeypatch):
    monkeypatch.setattr(settings, "EVOLUTION_URL", "http://evolution:8080")
    db.add(WhatsAppState(id=1, state="close"))
    db.commit()
    alert = notif_ids(client, admin).get("wa_disconnected")
    assert alert and alert["link"] == "/admin/whatsapp" and alert["severity"] == "critical"
    assert "wa_disconnected" not in notif_ids(client, staff)
    db.get(WhatsAppState, 1).state = "open"
    db.commit()
    assert "wa_disconnected" not in notif_ids(client, admin)


def test_no_alert_when_whatsapp_not_configured(client, db, admin, monkeypatch):
    monkeypatch.setattr(settings, "EVOLUTION_URL", "")
    assert "wa_disconnected" not in notif_ids(client, admin)

"""Lead chat API: read, send, media, take, ignore, other chats."""
from datetime import datetime, timezone

import pytest

from app.core.config import settings
from app.core.security import hash_password
from app.main import app
from app.models import (
    Department, Lead, LeadActivity, LeadSource, LeadStatus, Role, User, WhatsAppChat, WhatsAppMessage,
)
from app.services.first_touch import first_touch_at
from app.services.whatsapp import inbound
from app.services.whatsapp.provider import InboundMessage
from app.services.whatsapp.runtime import get_provider
from tests.conftest import auth_headers
from tests.whatsapp_fakes import FakeProvider

PHONE = "996700000001"   # = conftest lead.phone "+996 700 000001"


@pytest.fixture()
def fake(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "WHATSAPP_MEDIA_ROOT", str(tmp_path / "wa"))
    provider = FakeProvider()
    app.dependency_overrides[get_provider] = lambda: provider
    yield provider
    app.dependency_overrides.pop(get_provider, None)


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


def incoming(db, ext="IN1", body="Здравствуйте", phone=PHONE, kind="text", b64=None, mime=""):
    inbound.handle_events(db, [InboundMessage(
        external_id=ext, remote_jid=f"{phone}@s.whatsapp.net", phone=phone, from_me=False,
        push_name="Клиент", kind=kind, body=body, media_b64=b64, media_mime=mime, media_name="",
        sent_at=datetime(2026, 11, 20, 4, 0, tzinfo=timezone.utc),
    )])
    db.commit()


def test_access_endpoint(client, staff, outsider, admin, sales, fake):
    assert client.get("/api/whatsapp/access", headers=auth_headers(staff)).json() == {"can_use": True}
    assert client.get("/api/whatsapp/access", headers=auth_headers(admin)).json() == {"can_use": True}
    assert client.get("/api/whatsapp/access", headers=auth_headers(outsider)).json() == {"can_use": False}


def test_closer_flag_grants_access(client, db, outsider, fake):
    outsider.is_closer = True
    db.commit()
    assert client.get("/api/whatsapp/access", headers=auth_headers(outsider)).json() == {"can_use": True}


def test_staff_outside_sales_forbidden(client, db, lead, outsider, sales, fake):
    incoming(db, kind="image", b64="aGVsbG8=", mime="image/png")
    mid = db.query(WhatsAppMessage).one().id
    assert client.get(f"/api/whatsapp/leads/{lead.id}/messages", headers=auth_headers(outsider)).status_code == 403
    assert client.get(f"/api/whatsapp/media/{mid}", headers=auth_headers(outsider)).status_code == 403


def test_unauthenticated_media_401(client, db, lead, fake):
    incoming(db, kind="image", b64="aGVsbG8=", mime="image/png")
    mid = db.query(WhatsAppMessage).one().id
    assert client.get(f"/api/whatsapp/media/{mid}").status_code == 401


def test_media_served_to_sales(client, db, lead, staff, sales, fake):
    incoming(db, kind="image", b64="aGVsbG8=", mime="image/png")
    mid = db.query(WhatsAppMessage).one().id
    r = client.get(f"/api/whatsapp/media/{mid}", headers=auth_headers(staff))
    assert r.status_code == 200 and r.content == b"hello" and r.headers["content-type"].startswith("image/png")


def test_get_messages_marks_read(client, db, lead, staff, sales, fake):
    incoming(db)
    incoming(db, ext="IN2", body="Вы тут?")
    r = client.get(f"/api/whatsapp/leads/{lead.id}/messages", headers=auth_headers(staff))
    assert r.status_code == 200
    body = r.json()
    assert [m["body"] for m in body["messages"]] == ["Здравствуйте", "Вы тут?"]
    assert body["chat"]["phone"] == PHONE
    db.expire_all()
    assert db.query(WhatsAppChat).one().unread_count == 0
    last = body["messages"][-1]["id"]
    assert client.get(f"/api/whatsapp/leads/{lead.id}/messages?after_id={last}", headers=auth_headers(staff)).json()["messages"] == []


def test_messages_for_lead_without_chat(client, lead, staff, sales, fake):
    assert client.get(f"/api/whatsapp/leads/{lead.id}/messages", headers=auth_headers(staff)).json() == {"chat": None, "messages": []}


def test_send_text_success_sets_sender_and_setter(client, db, lead, staff, sales, fake):
    lead.setter_id = None
    db.commit()
    r = client.post(f"/api/whatsapp/leads/{lead.id}/messages", json={"text": "Добрый день!"}, headers=auth_headers(staff))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "sent" and r.json()["sender"]["id"] == staff.id
    assert fake.sent == [("text", PHONE, "Добрый день!")]
    db.expire_all()
    m = db.query(WhatsAppMessage).one()
    assert (m.external_id, m.direction, m.sender_user_id) == ("OUT1", "out", staff.id)
    assert db.get(Lead, lead.id).setter_id == staff.id
    assert db.query(WhatsAppChat).one().lead_id == lead.id


def test_send_text_provider_down_marks_failed(client, db, lead, staff, sales, fake):
    fake.fail_with = "номер не подключён"
    r = client.post(f"/api/whatsapp/leads/{lead.id}/messages", json={"text": "Привет"}, headers=auth_headers(staff))
    assert r.status_code == 502 and "Не удалось отправить" in r.json()["detail"]
    db.expire_all()
    m = db.query(WhatsAppMessage).one()
    assert m.status == "failed" and "номер не подключён" in m.error and m.external_id is None


def test_send_without_any_number_422(client, db, lead, staff, sales, fake):
    lead.phone, lead.whatsapp = "", ""
    db.commit()
    r = client.post(f"/api/whatsapp/leads/{lead.id}/messages", json={"text": "x"}, headers=auth_headers(staff))
    assert r.status_code == 422


def test_send_empty_text_422(client, lead, staff, sales, fake):
    assert client.post(f"/api/whatsapp/leads/{lead.id}/messages", json={"text": ""}, headers=auth_headers(staff)).status_code == 422


def test_send_media(client, db, lead, staff, sales, fake):
    r = client.post(f"/api/whatsapp/leads/{lead.id}/media", headers=auth_headers(staff),
                    files={"file": ("КП.pdf", b"%PDF-1", "application/pdf")}, data={"caption": "Наше КП"})
    assert r.status_code == 200, r.text
    assert fake.sent == [("media", PHONE, "application/pdf", "КП.pdf", "Наше КП", 6)]
    out = r.json()
    assert out["kind"] == "document" and out["has_media"] is True and out["media_name"] == "КП.pdf"


def test_media_upload_too_large_413(client, lead, staff, sales, fake, monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_MAX_UPLOAD_BYTES", 10)
    r = client.post(f"/api/whatsapp/leads/{lead.id}/media", headers=auth_headers(staff),
                    files={"file": ("big.bin", b"x" * 11, "application/octet-stream")})
    assert r.status_code == 413 and fake.sent == []


def test_take_lead(client, db, lead, staff, sales, fake):
    lead.setter_id = None
    db.commit()
    assert client.post(f"/api/whatsapp/leads/{lead.id}/take", headers=auth_headers(staff)).status_code == 200
    db.expire_all()
    assert db.get(Lead, lead.id).setter_id == staff.id
    acts = db.query(LeadActivity).filter_by(lead_id=lead.id, activity_type="taken").all()
    assert [(a.responsible_id, a.description) for a in acts] == [(staff.id, "Взял лида себе")]
    # Taking is not a touch: the new-lead timer and metrics ignore it.
    assert first_touch_at(db, [lead.id]) == {}


def test_take_conflict_409(client, db, lead, staff, admin, sales, fake):
    lead.setter_id = admin.id
    db.commit()
    assert client.post(f"/api/whatsapp/leads/{lead.id}/take", headers=auth_headers(staff)).status_code == 409


def test_ignore_archives_only_auto_created_lead(client, db, stages, staff, sales, fake):
    db.add(LeadSource(name="WhatsApp", position=0))
    db.commit()
    incoming(db, phone="996555111222")                       # creates a lead
    auto = db.query(WhatsAppChat).one()
    r = client.post(f"/api/whatsapp/chats/{auto.id}/ignore", headers=auth_headers(staff))
    assert r.status_code == 200
    db.expire_all()
    assert db.get(Lead, auto.created_lead_id).status == LeadStatus.archived

    manual = Lead(client_name="Ручной", phone="+996 555 333 444", stage_id=stages["Созвон"].id, status=LeadStatus.active)
    db.add(manual)
    db.commit()
    incoming(db, ext="IN9", phone="996555333444")
    chat = db.query(WhatsAppChat).filter_by(phone="996555333444").one()
    client.post(f"/api/whatsapp/chats/{chat.id}/ignore", headers=auth_headers(staff))
    db.expire_all()
    assert db.get(Lead, manual.id).status == LeadStatus.active and db.get(WhatsAppChat, chat.id).is_ignored


def test_other_chats_and_unignore(client, db, stages, staff, sales, fake):
    db.add(WhatsAppChat(remote_jid="996777000000@s.whatsapp.net", phone="996777000000"))
    db.add(WhatsAppChat(remote_jid="996777000001@s.whatsapp.net", phone="996777000001", is_ignored=True))
    db.commit()
    rows = client.get("/api/whatsapp/chats/other", headers=auth_headers(staff)).json()
    assert {c["phone"] for c in rows} == {"996777000000", "996777000001"}
    ignored = next(c for c in rows if c["is_ignored"])
    assert client.post(f"/api/whatsapp/chats/{ignored['id']}/unignore", headers=auth_headers(staff)).json()["is_ignored"] is False


def test_make_lead_from_unlinked_chat(client, db, stages, staff, sales, fake):
    chat = WhatsAppChat(remote_jid="996777000002@s.whatsapp.net", phone="996777000002", push_name="Бакыт")
    db.add(chat)
    db.commit()
    r = client.post(f"/api/whatsapp/chats/{chat.id}/make-lead", headers=auth_headers(staff))
    assert r.status_code == 200
    db.expire_all()
    lead = db.get(Lead, db.get(WhatsAppChat, chat.id).lead_id)
    assert lead.client_name == "Бакыт" and lead.stage_id == stages["Новый лид"].id


def test_lead_detail_has_chat_id(client, db, lead, staff, sales, fake):
    assert client.get(f"/api/leads/{lead.id}", headers=auth_headers(staff)).json()["whatsapp_chat_id"] is None
    incoming(db)
    chat_id = db.query(WhatsAppChat).one().id
    assert client.get(f"/api/leads/{lead.id}", headers=auth_headers(staff)).json()["whatsapp_chat_id"] == chat_id


def test_unsafe_image_type_served_as_download(client, db, lead, staff, sales, fake):
    """A client can label any file as an image; only real raster types are served inline."""
    incoming(db, kind="image", b64="PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+", mime="image/svg+xml")
    mid = db.query(WhatsAppMessage).one().id
    r = client.get(f"/api/whatsapp/media/{mid}", headers=auth_headers(staff))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/octet-stream")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"].startswith("attachment")


def test_safe_image_inline_with_nosniff(client, db, lead, staff, sales, fake):
    incoming(db, kind="image", b64="aGVsbG8=", mime="image/jpeg")
    mid = db.query(WhatsAppMessage).one().id
    r = client.get(f"/api/whatsapp/media/{mid}", headers=auth_headers(staff))
    assert r.headers["content-type"].startswith("image/jpeg") and r.headers["x-content-type-options"] == "nosniff"


def test_echo_of_sent_message_is_adopted_not_duplicated(client, db, lead, staff, sales, fake):
    """If Evolution echoes our own message as messages.upsert before we commit, keep one row, credited to the sender."""
    real_send = fake.send_text

    def send_with_echo(phone, text):
        result = real_send(phone, text)
        inbound.handle_events(db, [InboundMessage(
            external_id=result.external_id, remote_jid=f"{phone}@s.whatsapp.net", phone=phone, from_me=True,
            push_name="", kind="text", body=text, media_b64=None, media_mime="", media_name="",
            sent_at=datetime(2026, 11, 20, 4, 0, tzinfo=timezone.utc),
        )])
        return result

    fake.send_text = send_with_echo
    r = client.post(f"/api/whatsapp/leads/{lead.id}/messages", json={"text": "Привет"}, headers=auth_headers(staff))
    assert r.status_code == 200, r.text
    db.expire_all()
    rows = db.query(WhatsAppMessage).all()
    assert len(rows) == 1
    assert rows[0].external_id == "OUT1" and rows[0].sender_user_id == staff.id and rows[0].status == "sent"

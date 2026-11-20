"""Inbound WhatsApp processing: lead matching rules, chats, idempotency, media."""
import base64
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models import (
    Lead, LeadSource, LeadStatus, WhatsAppChat, WhatsAppMessage, WhatsAppState,
)
from app.services.whatsapp import inbound
from app.services.whatsapp.provider import ConnectionUpdate, InboundMessage, StatusUpdate

PHONE = "996700123456"
JID = f"{PHONE}@s.whatsapp.net"
T0 = datetime(2026, 11, 20, 4, 0, tzinfo=timezone.utc)


def msg(ext="M1", body="Здравствуйте", from_me=False, phone=PHONE, kind="text", b64=None, mime="", name="", at=T0):
    return InboundMessage(
        external_id=ext, remote_jid=f"{phone}@s.whatsapp.net", phone=phone, from_me=from_me,
        push_name="Асель", kind=kind, body=body, media_b64=b64, media_mime=mime, media_name=name, sent_at=at,
    )


@pytest.fixture()
def wa_source(db):
    src = LeadSource(name="WhatsApp", position=2)
    db.add(src)
    db.commit()
    return src


@pytest.fixture(autouse=True)
def media_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WHATSAPP_MEDIA_ROOT", str(tmp_path / "wa"))
    return tmp_path / "wa"


def run(db, *events):
    inbound.handle_events(db, list(events))
    db.commit()


def test_new_number_creates_unassigned_lead(db, stages, wa_source):
    run(db, msg())
    lead = db.query(Lead).one()
    chat = db.query(WhatsAppChat).one()
    assert lead.stage_id == stages["Новый лид"].id and lead.source_id == wa_source.id
    assert lead.setter_id is None and lead.client_name == "Асель" and lead.whatsapp == "+" + PHONE
    assert chat.lead_id == lead.id and chat.created_lead_id == lead.id
    assert chat.unread_count == 1 and chat.last_message_at.replace(tzinfo=timezone.utc) == T0
    m = db.query(WhatsAppMessage).one()
    assert (m.direction, m.status, m.body, m.external_id) == ("in", "received", "Здравствуйте", "M1")


def test_duplicate_event_is_idempotent(db, stages, wa_source):
    run(db, msg())
    run(db, msg())
    assert db.query(WhatsAppMessage).count() == 1 and db.query(Lead).count() == 1
    assert db.query(WhatsAppChat).one().unread_count == 1


def test_existing_lead_matched_by_local_format(db, stages, lead):
    lead.phone = "0700 123 456"
    db.commit()
    run(db, msg())
    assert db.query(Lead).count() == 1
    assert db.query(WhatsAppChat).one().lead_id == lead.id


def test_won_lead_gets_message_no_new_lead(db, stages, lead):
    lead.phone, lead.stage_id = "+996 700 123 456", stages["Оплачено"].id
    db.commit()
    run(db, msg())
    assert db.query(Lead).count() == 1 and db.query(WhatsAppChat).one().lead_id == lead.id


def test_lost_lead_creates_new_with_reference(db, stages, lead, wa_source):
    lead.phone, lead.stage_id = "+996 700 123 456", stages["Минус"].id
    db.commit()
    run(db, msg())
    new = db.query(Lead).filter(Lead.id != lead.id).one()
    assert f"#{lead.id}" in new.comment and new.stage_id == stages["Новый лид"].id
    assert db.query(WhatsAppChat).one().lead_id == new.id


def test_archived_lead_creates_new(db, stages, lead, wa_source):
    lead.phone, lead.status = "+996 700 123 456", LeadStatus.archived
    db.commit()
    run(db, msg())
    assert db.query(Lead).count() == 2


def test_chat_keeps_its_open_lead(db, stages, lead, wa_source):
    run(db, msg("A"))
    first = db.query(WhatsAppChat).one().lead_id
    run(db, msg("B", at=T0 + timedelta(minutes=1)))
    chat = db.query(WhatsAppChat).one()
    assert chat.lead_id == first and chat.unread_count == 2 and db.query(Lead).count() == 2


def test_ignored_chat_creates_no_lead(db, stages, wa_source):
    db.add(WhatsAppChat(remote_jid=JID, phone=PHONE, is_ignored=True))
    db.commit()
    run(db, msg())
    assert db.query(Lead).count() == 0 and db.query(WhatsAppMessage).count() == 1


def test_from_me_unknown_number_creates_chat_only(db, stages, wa_source):
    run(db, msg(from_me=True, body="Добрый день"))
    chat = db.query(WhatsAppChat).one()
    assert db.query(Lead).count() == 0 and chat.lead_id is None and chat.unread_count == 0
    m = db.query(WhatsAppMessage).one()
    assert (m.direction, m.status, m.sender_user_id) == ("out", "sent", None)


def test_status_update_does_not_downgrade_read(db, stages, wa_source):
    run(db, msg(ext="OUT1", from_me=True))
    run(db, StatusUpdate("OUT1", "read"))
    run(db, StatusUpdate("OUT1", "delivered"))
    assert db.query(WhatsAppMessage).one().status == "read"


def test_status_update_for_unknown_message_is_ignored(db):
    run(db, StatusUpdate("NOPE", "read"))
    assert db.query(WhatsAppMessage).count() == 0


def test_connection_update_stored(db):
    run(db, ConnectionUpdate("open"))
    state = db.get(WhatsAppState, 1)
    assert state.state == "open" and state.updated_at is not None
    run(db, ConnectionUpdate("close"))
    assert db.get(WhatsAppState, 1).state == "close"


def test_image_saved_outside_public_media(db, stages, wa_source, media_root):
    run(db, msg(kind="image", body="прайс", b64=base64.b64encode(b"\x89PNG").decode(), mime="image/png"))
    m = db.query(WhatsAppMessage).one()
    path = inbound.media_abspath(m.media_path)
    assert path.is_file() and path.read_bytes() == b"\x89PNG"
    assert str(path).startswith(str(media_root))
    assert m.media_mime == "image/png" and m.body == "прайс"
    with pytest.raises(ValueError):
        inbound.media_abspath("../../etc/passwd")


def test_broken_base64_keeps_text(db, stages, wa_source):
    run(db, msg(kind="image", body="подпись", b64="%%%not-base64%%%", mime="image/png"))
    m = db.query(WhatsAppMessage).one()
    assert m.body == "подпись" and m.media_path == ""

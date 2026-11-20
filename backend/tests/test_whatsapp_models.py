"""WhatsApp chat/message storage."""
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Lead, LeadStatus, WhatsAppChat, WhatsAppMessage, WhatsAppState


def test_chat_message_roundtrip(db, stages):
    lead = Lead(client_name="A", phone="+996700123456", stage_id=stages["Новый лид"].id, status=LeadStatus.active)
    db.add(lead)
    db.commit()
    chat = WhatsAppChat(remote_jid="996700123456@s.whatsapp.net", phone="996700123456", lead_id=lead.id)
    db.add(chat)
    db.flush()
    now = datetime.now(timezone.utc)
    db.add_all([
        WhatsAppMessage(chat_id=chat.id, external_id="IN1", direction="in", kind="text", body="Привет", status="received", sent_at=now),
        WhatsAppMessage(chat_id=chat.id, external_id=None, direction="out", kind="text", body="Здравствуйте", status="pending", sent_at=now),
    ])
    db.commit()
    assert db.query(WhatsAppMessage).filter_by(chat_id=chat.id).count() == 2
    assert chat.unread_count == 0 and chat.is_ignored is False

    db.delete(lead)
    db.commit()
    db.refresh(chat)
    assert chat.lead_id is None

    db.add(WhatsAppMessage(chat_id=chat.id, external_id="IN1", direction="in", kind="text", status="received", sent_at=now))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

    db.delete(chat)
    db.commit()
    assert db.query(WhatsAppMessage).count() == 0


def test_state_row_defaults(db):
    db.add(WhatsAppState(id=1))
    db.commit()
    assert db.get(WhatsAppState, 1).state == "unknown"

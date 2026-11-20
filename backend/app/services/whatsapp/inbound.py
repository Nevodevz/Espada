"""Turn provider events into chats, messages and leads (spec §5.4 «Входящее сообщение»)."""
import base64
import binascii
import logging
import mimetypes
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import (
    Lead, LeadSource, LeadStage, LeadStatus, WhatsAppChat, WhatsAppMessage, WhatsAppState,
)
from app.services.leads import create_lead_activity
from app.services.whatsapp.media import media_abspath, save_media  # noqa: F401 — re-exported
from app.services.whatsapp.provider import ConnectionUpdate, InboundMessage, StatusUpdate

log = logging.getLogger(__name__)

# A status only moves forward: a late «delivered» never overwrites «read».
_STATUS_RANK = {"pending": 0, "failed": 0, "sent": 1, "delivered": 2, "read": 3}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _lead_state(lead: Lead) -> str:
    if lead.status != LeadStatus.active:
        return "closed"
    kind = lead.stage.kind if lead.stage else "generic"
    if kind == "won":
        return "won"
    if kind == "lost":
        return "closed"
    return "open"


def find_lead_for_phone(db: Session, phone: str) -> tuple[Lead | None, str]:
    """Best lead for this number: an open one, else a won one, else the newest closed one."""
    if not phone:
        return None, "none"
    leads = (
        db.query(Lead)
        .filter(or_(Lead.phone_digits == phone, Lead.whatsapp_digits == phone))
        .order_by(Lead.created_at.desc(), Lead.id.desc())
        .all()
    )
    if not leads:
        return None, "none"
    by_state = {}
    for lead in leads:
        by_state.setdefault(_lead_state(lead), lead)
    for state in ("open", "won", "closed"):
        if state in by_state:
            return by_state[state], state
    return None, "none"


def get_or_create_chat(db: Session, remote_jid: str, phone: str) -> WhatsAppChat:
    chat = db.query(WhatsAppChat).filter(WhatsAppChat.remote_jid == remote_jid).first()
    if chat is None:
        chat = WhatsAppChat(remote_jid=remote_jid, phone=phone)
        db.add(chat)
        db.flush()
    return chat


def create_lead_for_chat(db: Session, chat: WhatsAppChat, previous: Lead | None = None) -> Lead:
    """New lead from a WhatsApp chat: first generic stage, source «WhatsApp», no setter."""
    stage = (
        db.query(LeadStage)
        .filter(LeadStage.is_archived == False, LeadStage.kind == "generic")  # noqa: E712
        .order_by(LeadStage.position, LeadStage.id)
        .first()
    )
    source = db.query(LeadSource).filter(LeadSource.name == "WhatsApp").first()
    lead = Lead(
        client_name=chat.push_name or f"+{chat.phone}",
        whatsapp=f"+{chat.phone}",
        stage_id=stage.id if stage else None,
        source_id=source.id if source else None,
        status=LeadStatus.active,
        comment=f"Повторное обращение. Предыдущий лид #{previous.id}" if previous else "",
    )
    db.add(lead)
    db.flush()
    create_lead_activity(db, lead_id=lead.id, activity_type="whatsapp", description="Заявка из WhatsApp")
    chat.lead_id = lead.id
    chat.created_lead_id = lead.id
    return lead


def _attach_lead(db: Session, chat: WhatsAppChat, allow_create: bool) -> None:
    if chat.lead is not None and _lead_state(chat.lead) in ("open", "won"):
        return
    lead, state = find_lead_for_phone(db, chat.phone)
    if state in ("open", "won"):
        chat.lead_id = lead.id
    elif allow_create:
        create_lead_for_chat(db, chat, previous=lead if state == "closed" else None)


def _store_media(db: Session, chat: WhatsAppChat, message: WhatsAppMessage, event: InboundMessage) -> None:
    try:
        data = base64.b64decode(event.media_b64, validate=True)
    except (binascii.Error, ValueError):
        log.warning("whatsapp: undecodable media in message %s", event.external_id)
        return
    name = event.media_name or f"{event.kind}{mimetypes.guess_extension(event.media_mime) or ''}"
    message.media_path = save_media(chat.id, message.id, data, name)
    message.media_name = name


def _handle_message(db: Session, event: InboundMessage) -> None:
    if db.query(WhatsAppMessage.id).filter(WhatsAppMessage.external_id == event.external_id).first():
        return
    chat = get_or_create_chat(db, event.remote_jid, event.phone)
    if event.push_name and not event.from_me:
        chat.push_name = event.push_name
    if not chat.is_ignored:
        # A message typed on the phone to an unknown number makes a chat, never a lead.
        _attach_lead(db, chat, allow_create=not event.from_me)

    message = WhatsAppMessage(
        chat_id=chat.id, external_id=event.external_id,
        direction="out" if event.from_me else "in",
        kind=event.kind, body=event.body, media_mime=event.media_mime, media_name=event.media_name,
        status="sent" if event.from_me else "received", sent_at=event.sent_at,
    )
    db.add(message)
    db.flush()
    if event.media_b64:
        _store_media(db, chat, message, event)

    if chat.last_message_at is None or event.sent_at >= _aware(chat.last_message_at):
        chat.last_message_at = event.sent_at
    if not event.from_me:
        chat.unread_count = (chat.unread_count or 0) + 1


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _handle_status(db: Session, event: StatusUpdate) -> None:
    message = db.query(WhatsAppMessage).filter(WhatsAppMessage.external_id == event.external_id).first()
    if message is None:
        return
    if _STATUS_RANK.get(event.status, 0) >= _STATUS_RANK.get(message.status, 0):
        message.status = event.status


def set_state(db: Session, state: str) -> WhatsAppState:
    row = db.get(WhatsAppState, 1)
    if row is None:
        row = WhatsAppState(id=1)
        db.add(row)
    row.state = state
    row.updated_at = _now()
    return row


def handle_events(db: Session, events: list) -> None:
    """Apply parsed provider events. The caller commits."""
    for event in events:
        if isinstance(event, InboundMessage):
            _handle_message(db, event)
        elif isinstance(event, StatusUpdate):
            _handle_status(db, event)
        elif isinstance(event, ConnectionUpdate):
            set_state(db, event.state)
    db.flush()

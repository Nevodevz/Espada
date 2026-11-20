"""WhatsApp: provider webhook, number connection (admin) and the lead chat API."""
import hmac
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models import Lead, LeadStatus, User, WhatsAppChat, WhatsAppMessage, WhatsAppState
from app.schemas import UserOut
from app.services.whatsapp.access import can_use_whatsapp
from app.services.whatsapp.evolution import mediatype_for, parse_webhook
from app.services.whatsapp.inbound import create_lead_for_chat, get_or_create_chat, handle_events, set_state
from app.services.whatsapp.media import media_abspath, save_media
from app.services.whatsapp.provider import ProviderError, WhatsAppProvider
from app.services.whatsapp.runtime import get_provider, webhook_url

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


# ───────────────────────── Webhook ──────────────────────────────

@router.post("/webhook/{secret}", include_in_schema=False)
async def webhook(secret: str, request: Request, db: Session = Depends(get_db)):
    expected = settings.WHATSAPP_WEBHOOK_SECRET
    if not expected or not hmac.compare_digest(secret.encode(), expected.encode()):
        raise HTTPException(404, "Not Found")
    try:
        payload = json.loads(await request.body())
        handle_events(db, parse_webhook(payload))
        db.commit()
    except Exception:
        # Answer 200 anyway: a non-2xx makes Evolution retry the same broken payload forever.
        db.rollback()
        log.exception("whatsapp: webhook processing failed")
        return {"ok": False}
    return {"ok": True}


# ───────────────────────── Connection (admin) ───────────────────

class StatusOut(BaseModel):
    configured: bool
    state: str
    updated_at: datetime | None = None


class ConnectOut(BaseModel):
    state: str
    qr_base64: str | None = None
    pairing_code: str | None = None


def _require_provider(provider: WhatsAppProvider | None) -> WhatsAppProvider:
    if provider is None:
        raise HTTPException(503, "WhatsApp не настроен: не задан EVOLUTION_URL")
    return provider


def _provider_call(fn, *args):
    try:
        return fn(*args)
    except ProviderError as exc:
        raise HTTPException(502, f"WhatsApp-шлюз: {exc}") from exc


@router.get("/status", response_model=StatusOut)
def status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    row = db.get(WhatsAppState, 1)
    return StatusOut(
        configured=bool(settings.EVOLUTION_URL),
        state=row.state if row else "unknown",
        updated_at=row.updated_at if row else None,
    )


@router.post("/connect", response_model=ConnectOut)
def connect(
    db: Session = Depends(get_db),
    provider: WhatsAppProvider | None = Depends(get_provider),
    _: User = Depends(require_admin),
):
    provider = _require_provider(provider)
    if not settings.WHATSAPP_WEBHOOK_SECRET:
        raise HTTPException(503, "WhatsApp не настроен: не задан WHATSAPP_WEBHOOK_SECRET")
    _provider_call(provider.ensure_instance, webhook_url())
    result = _provider_call(provider.connect)
    set_state(db, result["state"])
    db.commit()
    return ConnectOut(**result)


@router.post("/logout")
def logout(
    db: Session = Depends(get_db),
    provider: WhatsAppProvider | None = Depends(get_provider),
    _: User = Depends(require_admin),
):
    _provider_call(_require_provider(provider).logout)
    set_state(db, "close")
    db.commit()
    return {"state": "close"}


# ───────────────────────── Lead chat ────────────────────────────

class ChatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    phone: str
    push_name: str
    lead_id: int | None
    is_ignored: bool
    unread_count: int
    last_message_at: datetime | None = None


class MessageOut(BaseModel):
    id: int
    direction: str
    kind: str
    body: str
    status: str
    error: str
    sent_at: datetime
    sender: UserOut | None = None
    has_media: bool
    media_name: str
    media_mime: str


class ThreadOut(BaseModel):
    chat: ChatOut | None
    messages: list[MessageOut]


class SendText(BaseModel):
    text: str = Field(min_length=1, max_length=4096)

    @field_validator("text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Пустое сообщение")
        return value


def _message_out(m: WhatsAppMessage) -> MessageOut:
    return MessageOut(
        id=m.id, direction=m.direction, kind=m.kind, body=m.body, status=m.status, error=m.error,
        sent_at=m.sent_at, sender=UserOut.model_validate(m.sender) if m.sender else None,
        has_media=bool(m.media_path), media_name=m.media_name, media_mime=m.media_mime,
    )


def require_whatsapp_user(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> User:
    if not can_use_whatsapp(db, user):
        raise HTTPException(403, "Нет доступа к переписке WhatsApp")
    return user


def _lead(db: Session, lead_id: int) -> Lead:
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(404, "Лид не найден")
    return lead


def _chat(db: Session, chat_id: int) -> WhatsAppChat:
    chat = db.get(WhatsAppChat, chat_id)
    if chat is None:
        raise HTTPException(404, "Чат не найден")
    return chat


def _newest(query):
    return query.order_by(WhatsAppChat.last_message_at.desc().nullslast(), WhatsAppChat.id.desc()).first()


def lead_chat(db: Session, lead: Lead) -> WhatsAppChat | None:
    """The chat bound to the lead, else the most recent chat with the same number."""
    chat = _newest(db.query(WhatsAppChat).filter(WhatsAppChat.lead_id == lead.id))
    if chat:
        return chat
    phones = [p for p in (lead.whatsapp_digits, lead.phone_digits) if p]
    if not phones:
        return None
    return _newest(db.query(WhatsAppChat).filter(WhatsAppChat.phone.in_(phones)))


def _chat_for_sending(db: Session, lead: Lead) -> WhatsAppChat:
    chat = lead_chat(db, lead)
    if chat is None:
        phone = lead.whatsapp_digits or lead.phone_digits
        if not phone:
            raise HTTPException(422, "У лида нет номера телефона или WhatsApp")
        chat = get_or_create_chat(db, f"{phone}@s.whatsapp.net", phone)
    chat.lead_id = lead.id
    return chat


def _deliver(db: Session, lead: Lead, chat: WhatsAppChat, message: WhatsAppMessage, user: User, send) -> MessageOut:
    """The message is already stored as pending; a provider failure stays visible as «failed»."""
    try:
        result = send()
    except ProviderError as exc:
        message.status = "failed"
        message.error = str(exc)[:500]
        db.commit()
        raise HTTPException(502, f"Не удалось отправить: {exc}") from exc
    message.external_id = result.external_id
    message.status = "sent"
    chat.last_message_at = message.sent_at
    if lead.setter_id is None:
        lead.setter_id = user.id
    db.commit()
    db.refresh(message)
    return _message_out(message)


@router.get("/access")
def access(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"can_use": can_use_whatsapp(db, user)}


@router.get("/leads/{lead_id}/messages", response_model=ThreadOut)
def lead_messages(
    lead_id: int,
    after_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_whatsapp_user),
):
    chat = lead_chat(db, _lead(db, lead_id))
    if chat is None:
        return ThreadOut(chat=None, messages=[])
    q = db.query(WhatsAppMessage).options(joinedload(WhatsAppMessage.sender)).filter(WhatsAppMessage.chat_id == chat.id)
    if after_id:
        rows = q.filter(WhatsAppMessage.id > after_id).order_by(WhatsAppMessage.sent_at, WhatsAppMessage.id).all()
    else:
        rows = list(reversed(q.order_by(WhatsAppMessage.sent_at.desc(), WhatsAppMessage.id.desc()).limit(200).all()))
    if chat.unread_count:
        chat.unread_count = 0
        db.commit()
    return ThreadOut(chat=ChatOut.model_validate(chat), messages=[_message_out(m) for m in rows])


@router.post("/leads/{lead_id}/messages", response_model=MessageOut)
def send_text(
    lead_id: int,
    body: SendText,
    db: Session = Depends(get_db),
    provider: WhatsAppProvider | None = Depends(get_provider),
    user: User = Depends(require_whatsapp_user),
):
    lead = _lead(db, lead_id)
    provider = _require_provider(provider)
    chat = _chat_for_sending(db, lead)
    message = WhatsAppMessage(
        chat_id=chat.id, direction="out", sender_user_id=user.id, kind="text", body=body.text,
        status="pending", sent_at=datetime.now(timezone.utc),
    )
    db.add(message)
    db.flush()
    return _deliver(db, lead, chat, message, user, lambda: provider.send_text(chat.phone, body.text))


@router.post("/leads/{lead_id}/media", response_model=MessageOut)
async def send_media(
    lead_id: int,
    file: UploadFile = File(...),
    caption: str = Form(""),
    db: Session = Depends(get_db),
    provider: WhatsAppProvider | None = Depends(get_provider),
    user: User = Depends(require_whatsapp_user),
):
    lead = _lead(db, lead_id)
    provider = _require_provider(provider)
    data = await file.read(settings.WHATSAPP_MAX_UPLOAD_BYTES + 1)
    if len(data) > settings.WHATSAPP_MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Файл больше {settings.WHATSAPP_MAX_UPLOAD_BYTES // (1024 * 1024)} МБ")
    if not data:
        raise HTTPException(422, "Пустой файл")
    mime = file.content_type or "application/octet-stream"
    name = (file.filename or "file")[:255]
    chat = _chat_for_sending(db, lead)
    message = WhatsAppMessage(
        chat_id=chat.id, direction="out", sender_user_id=user.id, kind=mediatype_for(mime),
        body=caption[:4096], media_mime=mime, media_name=name, status="pending",
        sent_at=datetime.now(timezone.utc),
    )
    db.add(message)
    db.flush()
    message.media_path = save_media(chat.id, message.id, data, name)
    return _deliver(db, lead, chat, message, user, lambda: provider.send_media(chat.phone, data, mime, name, caption))


@router.get("/media/{message_id}")
def media(message_id: int, db: Session = Depends(get_db), _: User = Depends(require_whatsapp_user)):
    message = db.get(WhatsAppMessage, message_id)
    if message is None or not message.media_path:
        raise HTTPException(404, "Файл не найден")
    try:
        path = media_abspath(message.media_path)
    except ValueError:
        raise HTTPException(404, "Файл не найден")
    if not path.is_file():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, media_type=message.media_mime or "application/octet-stream",
                        filename=message.media_name or path.name)


@router.post("/leads/{lead_id}/take")
def take_lead(lead_id: int, db: Session = Depends(get_db), user: User = Depends(require_whatsapp_user)):
    lead = _lead(db, lead_id)
    if lead.setter_id not in (None, user.id):
        raise HTTPException(409, "У лида уже есть сеттер")
    lead.setter_id = user.id
    db.commit()
    return {"lead_id": lead.id, "setter_id": user.id}


@router.post("/chats/{chat_id}/ignore", response_model=ChatOut)
def ignore_chat(chat_id: int, db: Session = Depends(get_db), _: User = Depends(require_whatsapp_user)):
    chat = _chat(db, chat_id)
    chat.is_ignored = True
    if chat.lead_id and chat.lead_id == chat.created_lead_id:
        lead = db.get(Lead, chat.lead_id)
        if lead:
            lead.status = LeadStatus.archived
    db.commit()
    return ChatOut.model_validate(chat)


@router.post("/chats/{chat_id}/unignore", response_model=ChatOut)
def unignore_chat(chat_id: int, db: Session = Depends(get_db), _: User = Depends(require_whatsapp_user)):
    chat = _chat(db, chat_id)
    chat.is_ignored = False
    db.commit()
    return ChatOut.model_validate(chat)


@router.post("/chats/{chat_id}/make-lead", response_model=ChatOut)
def make_lead(chat_id: int, db: Session = Depends(get_db), _: User = Depends(require_whatsapp_user)):
    chat = _chat(db, chat_id)
    if chat.lead is not None and chat.lead.status == LeadStatus.active:
        raise HTTPException(409, "Чат уже привязан к лиду")
    chat.is_ignored = False
    create_lead_for_chat(db, chat)
    db.commit()
    return ChatOut.model_validate(chat)


@router.get("/chats/other", response_model=list[ChatOut])
def other_chats(db: Session = Depends(get_db), _: User = Depends(require_whatsapp_user)):
    rows = (
        db.query(WhatsAppChat)
        .filter(or_(WhatsAppChat.lead_id.is_(None), WhatsAppChat.is_ignored == True))  # noqa: E712
        .order_by(WhatsAppChat.last_message_at.desc().nullslast(), WhatsAppChat.id.desc())
        .limit(200).all()
    )
    return [ChatOut.model_validate(c) for c in rows]

"""WhatsApp: provider webhook, number connection (admin) and the lead chat API."""
import hmac
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import require_admin
from app.models import User, WhatsAppState
from app.services.whatsapp.evolution import parse_webhook
from app.services.whatsapp.inbound import handle_events, set_state
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

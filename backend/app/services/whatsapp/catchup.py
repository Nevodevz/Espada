"""Pull messages Evolution stored but whose webhooks never reached us (backend down too long).

Evolution gives up after 10 webhook retries; without this, a lead written during a long outage
would be lost silently. Runs at startup and periodically; dedup by `external_id` makes it safe
to repeat.
"""
import dataclasses
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import WhatsAppMessage
from app.services.whatsapp.inbound import handle_events
from app.services.whatsapp.provider import ProviderError, WhatsAppProvider

log = logging.getLogger(__name__)


def catch_up(db: Session, provider: WhatsAppProvider, since: datetime) -> int:
    """Store the messages since `since` that we do not have yet. Returns how many were added. Caller commits."""
    recent = provider.recent_messages(since)
    if not recent:
        return 0
    ids = [m.external_id for m in recent]
    known = {row[0] for row in db.query(WhatsAppMessage.external_id).filter(WhatsAppMessage.external_id.in_(ids))}
    missing = [m for m in recent if m.external_id not in known]
    events = []
    for message in missing:
        if message.kind != "text" and not message.media_b64:
            try:
                b64 = provider.media_base64(message.external_id)
            except ProviderError as exc:
                log.warning("whatsapp catch-up: media of %s unavailable: %s", message.external_id, exc)
                b64 = None
            if b64:
                message = dataclasses.replace(message, media_b64=b64)
        events.append(message)
    handle_events(db, sorted(events, key=lambda m: m.sent_at))
    if events:
        log.info("whatsapp catch-up: stored %d missed message(s)", len(events))
    return len(events)

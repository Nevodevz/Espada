"""Data for the sales «Сегодня» screen."""
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models import Lead, LeadStage, LeadStatus, User, WhatsAppChat, WhatsAppMessage
from app.services.first_touch import working_minutes
from app.services.sales_access import is_sales_head


def unclaimed_leads(db: Session, limit: int = 50, now: datetime | None = None) -> list[dict]:
    """Open leads nobody has taken yet (no setter), oldest first."""
    now = now or datetime.now(timezone.utc)
    closed = db.query(LeadStage.id).filter(LeadStage.is_won | LeadStage.is_lost)
    rows = (
        db.query(Lead)
        .filter(Lead.setter_id.is_(None), Lead.status != LeadStatus.archived)
        .filter(Lead.stage_id.is_(None) | Lead.stage_id.notin_(closed))
        .order_by(Lead.created_at.asc(), Lead.id.asc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": l.id,
            "client_name": l.client_name,
            "phone": l.phone,
            "source_name": l.source.name if l.source else None,
            "created_at": l.created_at,
            "waiting_minutes": working_minutes(l.created_at, now),
        }
        for l in rows
    ]


def awaiting_reply(db: Session, user: User, limit: int = 50) -> list[dict]:
    """Leads whose chat's latest message is inbound, oldest unanswered first."""
    last = (
        db.query(WhatsAppMessage.chat_id.label("chat_id"), func.max(WhatsAppMessage.sent_at).label("at"))
        .group_by(WhatsAppMessage.chat_id)
        .subquery()
    )
    q = (
        db.query(Lead, WhatsAppMessage)
        .join(WhatsAppChat, WhatsAppChat.lead_id == Lead.id)
        .join(last, last.c.chat_id == WhatsAppChat.id)
        .join(WhatsAppMessage, and_(WhatsAppMessage.chat_id == last.c.chat_id,
                                    WhatsAppMessage.sent_at == last.c.at))
        .outerjoin(LeadStage, LeadStage.id == Lead.stage_id)
        .filter(WhatsAppMessage.direction == "in")
        .filter(Lead.status != LeadStatus.archived)
        .filter(LeadStage.id.is_(None) | (LeadStage.is_lost.is_(False)))
    )
    if not is_sales_head(user):
        q = q.filter(or_(Lead.setter_id == user.id, Lead.closer_id == user.id, Lead.setter_id.is_(None)))
    rows = q.order_by(last.c.at.asc(), Lead.id.asc()).all()
    out, seen = [], set()
    for lead, msg in rows:  # a lead may have several chats; keep the oldest waiting one
        if lead.id in seen:
            continue
        seen.add(lead.id)
        out.append({"lead_id": lead.id, "client_name": lead.client_name,
                    "last_body": msg.body, "last_at": msg.sent_at})
        if len(out) >= limit:
            break
    return out

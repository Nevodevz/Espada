"""Data for the sales «Сегодня» screen."""
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models import Lead, LeadActivity, LeadStage, LeadStatus, User, WhatsAppChat, WhatsAppMessage
from app.services.first_touch import (TAKEN_ACTIVITY, activity_touches, early_stage_ids, first_touch_at,
                                      is_early, message_touches, working_minutes)
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
    early = early_stage_ids(db)
    early_ids = [l.id for l in rows if is_early(l.stage_id, early)]
    waiting = set(early_ids) - set(first_touch_at(db, early_ids))
    return [
        {
            "id": l.id,
            "client_name": l.client_name,
            "phone": l.phone,
            "source_name": l.source.name if l.source else None,
            "created_at": l.created_at,
            # Timer only while the lead sits on an early stage untouched.
            "waiting_minutes": working_minutes(l.created_at, now) if l.id in waiting else None,
        }
        for l in rows
    ]


def _last_answers(db: Session):
    """(lead_id, at) of the latest human answer per lead: any touch or «Взять себе».

    A bot reply (outbound without an employee) is not an answer, so a lead the bot
    talked to stays in «не ответили» until someone takes it, writes or calls.
    """
    acts = activity_touches(db, LeadActivity.lead_id.label("lead_id"), LeadActivity.created_at.label("at"))
    msgs = message_touches(db, WhatsAppChat.lead_id.label("lead_id"), WhatsAppMessage.sent_at.label("at"))
    taken = db.query(LeadActivity.lead_id.label("lead_id"), LeadActivity.created_at.label("at")).filter(
        LeadActivity.activity_type == TAKEN_ACTIVITY)
    answers = acts.union_all(msgs, taken).subquery()
    return (
        db.query(answers.c.lead_id.label("lead_id"), func.max(answers.c.at).label("at"))
        .group_by(answers.c.lead_id)
        .subquery()
    )


def awaiting_reply(db: Session, user: User, limit: int = 50) -> list[dict]:
    """Leads whose client wrote after the last human answer, oldest waiting first."""
    last_in = (
        db.query(WhatsAppChat.lead_id.label("lead_id"), func.max(WhatsAppMessage.sent_at).label("at"))
        .join(WhatsAppChat, WhatsAppChat.id == WhatsAppMessage.chat_id)
        .filter(WhatsAppMessage.direction == "in", WhatsAppChat.lead_id.isnot(None))
        .group_by(WhatsAppChat.lead_id)
        .subquery()
    )
    answered = _last_answers(db)
    q = (
        db.query(Lead, WhatsAppMessage)
        .join(last_in, last_in.c.lead_id == Lead.id)
        .join(WhatsAppChat, WhatsAppChat.lead_id == Lead.id)
        .join(WhatsAppMessage, and_(WhatsAppMessage.chat_id == WhatsAppChat.id,
                                    WhatsAppMessage.direction == "in",
                                    WhatsAppMessage.sent_at == last_in.c.at))
        .outerjoin(answered, answered.c.lead_id == Lead.id)
        .outerjoin(LeadStage, LeadStage.id == Lead.stage_id)
        .filter(answered.c.at.is_(None) | (answered.c.at < last_in.c.at))
        .filter(Lead.status != LeadStatus.archived)
        .filter(LeadStage.id.is_(None) | (LeadStage.is_lost.is_(False)))
    )
    if not is_sales_head(user):
        q = q.filter(or_(Lead.setter_id == user.id, Lead.closer_id == user.id, Lead.setter_id.is_(None)))
    rows = q.order_by(last_in.c.at.asc(), Lead.id.asc()).all()
    out, seen = [], set()
    for lead, msg in rows:  # two chats may hold a message with the same timestamp
        if lead.id in seen:
            continue
        seen.add(lead.id)
        out.append({"lead_id": lead.id, "client_name": lead.client_name,
                    "last_body": msg.body, "last_at": msg.sent_at})
        if len(out) >= limit:
            break
    return out

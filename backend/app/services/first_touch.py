"""Working-hours clock and first-touch lookup for sales leads."""
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import LeadActivity, WhatsAppChat, WhatsAppMessage
from app.services.leads import BISHKEK_TZ

WORK_START_HOUR = 10
WORK_END_HOUR = 19
WORK_WEEKDAYS = {0, 1, 2, 3, 4}
NON_MANUAL_ACTIVITIES = ("stage_change", "call_result", "whatsapp")


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def working_minutes(start: datetime, end: datetime) -> int:
    """Minutes between two moments that fall inside Mon-Fri 10:00-19:00 Bishkek."""
    start = _aware(start).astimezone(BISHKEK_TZ)
    end = _aware(end).astimezone(BISHKEK_TZ)
    if end <= start:
        return 0
    total = timedelta()
    day = start.date()
    while day <= end.date():
        if day.weekday() in WORK_WEEKDAYS:
            open_at = datetime.combine(day, time(WORK_START_HOUR), tzinfo=BISHKEK_TZ)
            close_at = datetime.combine(day, time(WORK_END_HOUR), tzinfo=BISHKEK_TZ)
            lo, hi = max(open_at, start), min(close_at, end)
            if hi > lo:
                total += hi - lo
        day += timedelta(days=1)
    return int(total.total_seconds() // 60)


def touch_rows(db: Session, *, start: datetime | None = None, end: datetime | None = None,
               lead_ids: list[int] | None = None) -> list[tuple[int, int, datetime]]:
    """(user_id, lead_id, at) for every touch: call result, manual activity, outbound WhatsApp."""
    acts = (
        db.query(LeadActivity.responsible_id, LeadActivity.lead_id, LeadActivity.created_at)
        .filter(LeadActivity.responsible_id.isnot(None))
        .filter(or_(LeadActivity.activity_type == "call_result",
                    LeadActivity.activity_type.notin_(NON_MANUAL_ACTIVITIES)))
    )
    msgs = (
        db.query(WhatsAppMessage.sender_user_id, WhatsAppChat.lead_id, WhatsAppMessage.sent_at)
        .join(WhatsAppChat, WhatsAppChat.id == WhatsAppMessage.chat_id)
        .filter(WhatsAppMessage.direction == "out", WhatsAppMessage.sender_user_id.isnot(None),
                WhatsAppChat.lead_id.isnot(None))
    )
    if start is not None:
        acts = acts.filter(LeadActivity.created_at >= start)
        msgs = msgs.filter(WhatsAppMessage.sent_at >= start)
    if end is not None:
        acts = acts.filter(LeadActivity.created_at < end)
        msgs = msgs.filter(WhatsAppMessage.sent_at < end)
    if lead_ids is not None:
        acts = acts.filter(LeadActivity.lead_id.in_(lead_ids))
        msgs = msgs.filter(WhatsAppChat.lead_id.in_(lead_ids))
    return [tuple(r) for r in acts.all()] + [tuple(r) for r in msgs.all()]


def first_touch_at(db: Session, lead_ids: list[int]) -> dict[int, datetime]:
    """Earliest touch per lead (UTC-aware); leads without touches are absent."""
    if not lead_ids:
        return {}
    out: dict[int, datetime] = {}
    for _, lead_id, at in touch_rows(db, lead_ids=lead_ids):
        at = _aware(at)
        if lead_id not in out or at < out[lead_id]:
            out[lead_id] = at
    return out

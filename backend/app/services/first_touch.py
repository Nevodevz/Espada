"""Working-hours clock, touch definition and first-touch lookup for sales leads."""
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import LeadActivity, LeadStage, WhatsAppChat, WhatsAppMessage
from app.services.leads import BISHKEK_TZ

WORK_START_HOUR = 10
WORK_END_HOUR = 19
WORK_WEEKDAYS = {0, 1, 2, 3, 4}
# Activity types that are not a manual touch. `call_result` is still a touch
# (counted as a call); `created` is the system «Лид создан» row and `note` is an
# internal note from the composer — neither reaches the client. `taken` is «Взять себе».
TAKEN_ACTIVITY = "taken"
NON_MANUAL_ACTIVITIES = ("stage_change", "call_result", "whatsapp", "created", "note", TAKEN_ACTIVITY)


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


def early_stage_ids(db: Session) -> set[int]:
    """Generic stages placed before the first non-generic active stage («Новый лид», «Созвон»…).

    Only leads on these stages (or without a stage) can be waiting for a first touch:
    the board/«Сегодня» timer and the «Без касания» count use this predicate.
    """
    stages = db.query(LeadStage.id, LeadStage.position, LeadStage.kind, LeadStage.is_archived).all()
    bounds = [pos for _, pos, kind, archived in stages if (kind or "generic") != "generic" and not archived]
    limit = min(bounds) if bounds else None
    return {sid for sid, pos, kind, _ in stages
            if (kind or "generic") == "generic" and (limit is None or pos < limit)}


def is_early(stage_id: int | None, early_ids: set[int]) -> bool:
    return stage_id is None or stage_id in early_ids


def activity_touches(db: Session, *columns):
    """Activities that count as a touch: call results and manual activities by an employee."""
    return (
        db.query(*columns)
        .filter(LeadActivity.responsible_id.isnot(None))
        .filter(or_(LeadActivity.activity_type == "call_result",
                    LeadActivity.activity_type.notin_(NON_MANUAL_ACTIVITIES)))
    )


def message_touches(db: Session, *columns):
    """Outbound WhatsApp messages sent by an employee in a chat linked to a lead."""
    return (
        db.query(*columns)
        .select_from(WhatsAppMessage)
        .join(WhatsAppChat, WhatsAppChat.id == WhatsAppMessage.chat_id)
        .filter(WhatsAppMessage.direction == "out", WhatsAppMessage.sender_user_id.isnot(None),
                WhatsAppChat.lead_id.isnot(None))
    )


def touch_rows(db: Session, *, start: datetime | None = None, end: datetime | None = None,
               lead_ids: list[int] | None = None) -> list[tuple[int, int, datetime]]:
    """(user_id, lead_id, at) for every touch: call result, manual activity, outbound WhatsApp."""
    acts = activity_touches(db, LeadActivity.responsible_id, LeadActivity.lead_id, LeadActivity.created_at)
    msgs = message_touches(db, WhatsAppMessage.sender_user_id, WhatsAppChat.lead_id, WhatsAppMessage.sent_at)
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
    acts = (activity_touches(db, LeadActivity.lead_id, func.min(LeadActivity.created_at))
            .filter(LeadActivity.lead_id.in_(lead_ids)).group_by(LeadActivity.lead_id).all())
    msgs = (message_touches(db, WhatsAppChat.lead_id, func.min(WhatsAppMessage.sent_at))
            .filter(WhatsAppChat.lead_id.in_(lead_ids)).group_by(WhatsAppChat.lead_id).all())
    out: dict[int, datetime] = {}
    for lead_id, at in [*acts, *msgs]:
        if at is None:
            continue
        at = _aware(at)
        if lead_id not in out or at < out[lead_id]:
            out[lead_id] = at
    return out

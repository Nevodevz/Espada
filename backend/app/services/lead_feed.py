"""One chronological feed for the lead card (spec 2026-11-20 §5.3).

Every source becomes `FeedItem(key, type, at, actor, data)`. Order is `(at, key)` descending;
the cursor is the last `(at, key)` of a page, so ties on `at` never lose or repeat items.
Keys zero-pad ids so string order equals id order inside a source.
"""
import base64
from dataclasses import dataclass, field
from datetime import datetime, time, timezone

from sqlalchemy.orm import Session, joinedload

from app.models import (
    Deal, DealPayment, Lead, LeadActivity, LeadFile, LeadStage, LeadStageHistory, LeadTask, Meeting,
    User, WhatsAppChat, WhatsAppMessage,
)
from app.services import deals as deal_service

# Activities the feed already shows from their own source.
HIDDEN_ACTIVITY_TYPES = ("stage_change", "call_result", "task_done")


@dataclass
class FeedItem:
    key: str
    type: str
    at: datetime
    actor: User | None = None
    data: dict = field(default_factory=dict)


def _aware(value: datetime | None) -> datetime:
    if value is None:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _key(kind: str, ident: int) -> str:
    return f"{kind}:{ident:010d}"


def encode_cursor(at: datetime, key: str) -> str:
    return base64.urlsafe_b64encode(f"{_aware(at).isoformat()}|{key}".encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    stamp, key = raw.split("|", 1)
    return _aware(datetime.fromisoformat(stamp)), key


def _window(query, at_col, id_col, cut: datetime | None, limit: int):
    """Rows older than the cursor (limit) plus every row exactly at the cursor time (ties)."""
    ordered = (at_col.desc(), id_col.desc())
    if cut is None:
        return query.order_by(*ordered).limit(limit).all()
    naive_cut = cut.replace(tzinfo=None)
    older = query.filter(at_col < naive_cut).order_by(*ordered).limit(limit).all()
    ties = query.filter(at_col >= naive_cut, at_col <= naive_cut).all()
    return older + ties


def build_feed(db: Session, lead: Lead, *, include_messages: bool, before: str | None,
               limit: int) -> tuple[list[FeedItem], str | None]:
    cut_at, cut_key = decode_cursor(before) if before else (None, None)
    n = limit + 1
    items: list[FeedItem] = []
    users: dict[int, User] = {}

    def actor(user_id: int | None) -> User | None:
        if not user_id:
            return None
        if user_id not in users:
            users[user_id] = db.get(User, user_id)
        return users[user_id]

    items.append(FeedItem(_key("created", lead.id), "created", _aware(lead.created_at),
                          data={"client_name": lead.client_name}))

    stage_names = {s.id: s.name for s in db.query(LeadStage).all()}
    for h in _window(db.query(LeadStageHistory).filter(LeadStageHistory.lead_id == lead.id),
                     LeadStageHistory.created_at, LeadStageHistory.id, cut_at, n):
        items.append(FeedItem(_key("stage", h.id), "stage", _aware(h.created_at), actor(h.changed_by), {
            "from": stage_names.get(h.from_stage_id), "to": stage_names.get(h.to_stage_id), "comment": h.comment,
        }))

    acts = db.query(LeadActivity).filter(LeadActivity.lead_id == lead.id,
                                         LeadActivity.activity_type.notin_(HIDDEN_ACTIVITY_TYPES))
    for a in _window(acts, LeadActivity.created_at, LeadActivity.id, cut_at, n):
        kind = "note" if a.activity_type == "note" else "activity"
        items.append(FeedItem(_key(kind, a.id), kind, _aware(a.created_at), actor(a.responsible_id), {
            "activity_type": a.activity_type, "channel": a.channel, "description": a.description,
        }))

    if include_messages:
        chat_ids = [c.id for c in db.query(WhatsAppChat.id).filter(WhatsAppChat.lead_id == lead.id)]
        if chat_ids:
            msgs = db.query(WhatsAppMessage).filter(WhatsAppMessage.chat_id.in_(chat_ids))
            for m in _window(msgs, WhatsAppMessage.sent_at, WhatsAppMessage.id, cut_at, n):
                items.append(FeedItem(_key("message", m.id), "message", _aware(m.sent_at), actor(m.sender_user_id), {
                    "id": m.id, "direction": m.direction, "kind": m.kind, "body": m.body, "status": m.status,
                    "error": m.error, "has_media": bool(m.media_path), "media_name": m.media_name,
                    "media_mime": m.media_mime,
                }))

    for mt in _window(db.query(Meeting).filter(Meeting.lead_id == lead.id), Meeting.created_at, Meeting.id, cut_at, n):
        items.append(FeedItem(_key("meeting", mt.id), "meeting", _aware(mt.created_at), actor(mt.setter_id), {
            "meeting_date": _aware(mt.meeting_date).isoformat(), "status": mt.status.value if mt.status else None,
            "address": mt.address, "closer": (actor(mt.closer_id).name if mt.closer_id and actor(mt.closer_id) else None),
        }))

    tasks = db.query(LeadTask).filter(LeadTask.lead_id == lead.id)
    for t in _window(tasks, LeadTask.created_at, LeadTask.id, cut_at, n):
        items.append(FeedItem(_key("task_created", t.id), "task_created", _aware(t.created_at), actor(t.created_by), {
            "task_id": t.id, "kind": t.kind, "due_at": _aware(t.due_at).isoformat(), "comment": t.comment,
            "assignee": actor(t.assignee_id).name if t.assignee_id and actor(t.assignee_id) else None,
        }))
    done = tasks.filter(LeadTask.status == "done", LeadTask.completed_at.isnot(None))
    for t in _window(done, LeadTask.completed_at, LeadTask.id, cut_at, n):
        items.append(FeedItem(_key("task_done", t.id), "task_done", _aware(t.completed_at), actor(t.completed_by), {
            "task_id": t.id, "kind": t.kind, "result": t.result, "note": t.result_note, "comment": t.comment,
        }))

    for f in _window(db.query(LeadFile).filter(LeadFile.lead_id == lead.id), LeadFile.created_at, LeadFile.id, cut_at, n):
        items.append(FeedItem(_key("file", f.id), "file", _aware(f.created_at), actor(f.uploaded_by), {
            "name": f.name, "url": f.url, "file_type": f.file_type,
        }))

    payments = (
        db.query(DealPayment).join(Deal, Deal.id == DealPayment.deal_id)
        .filter(Deal.lead_id == lead.id, DealPayment.status.in_(deal_service.CONFIRMED_STATUSES),
                DealPayment.paid_date.isnot(None))
        .all()
    )
    for p in payments:
        stamp = datetime.combine(p.paid_date, time(12, 0), tzinfo=timezone.utc)
        items.append(FeedItem(_key("payment", p.id), "payment", stamp, data={
            "amount": int(p.paid_amount or 0), "method": p.payment_method or "",
        }))

    if cut_at is not None:
        items = [i for i in items if (i.at, i.key) < (cut_at, cut_key)]
    items.sort(key=lambda i: (i.at, i.key), reverse=True)
    page = items[:limit]
    next_cursor = encode_cursor(page[-1].at, page[-1].key) if len(items) > limit else None
    return page, next_cursor

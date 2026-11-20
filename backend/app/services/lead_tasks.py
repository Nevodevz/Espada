"""Lead tasks: next steps on a lead (spec 2026-11-20 §5.1).

The no-answer streak is derived, never stored: `call` tasks closed as `no_answer`
after the later of (last `connected` call, last inbound WhatsApp message).
"""
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Lead, LeadTask, WhatsAppChat, WhatsAppMessage
from app.services.leads import create_lead_activity

TASK_KINDS = ("call", "message", "meeting", "other")
COMPLETE_RESULTS = ("connected", "no_answer", "done")
NO_ANSWER_LOST_THRESHOLD = 5

KIND_LABELS = {"call": "Позвонить", "message": "Написать", "meeting": "Встреча", "other": "Задача"}

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _aware(value: datetime | None) -> datetime:
    if value is None:
        return _EPOCH
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_task(db: Session, lead: Lead, *, kind: str, due_at: datetime, assignee_id: int | None,
                created_by: int | None, comment: str = "") -> LeadTask:
    task = LeadTask(lead_id=lead.id, kind=kind, due_at=due_at, assignee_id=assignee_id,
                    created_by=created_by, comment=comment or "", status="open")
    db.add(task)
    db.flush()
    return task


def _result_text(task: LeadTask, result: str, note: str) -> str:
    if result == "no_answer":
        text = "📵 Недозвон"
    elif result == "connected":
        text = "✅ Дозвонился"
    else:
        text = f"✔ Выполнено: {KIND_LABELS.get(task.kind, 'Задача')}"
        if task.comment:
            text += f" — {task.comment}"
    if note:
        text += f": {note}"
    return text


def complete_task(db: Session, task: LeadTask, *, result: str, note: str, user_id: int) -> LeadTask:
    task.status = "done"
    task.result = result
    task.result_note = note or ""
    task.completed_at = _now()
    task.completed_by = user_id
    create_lead_activity(
        db, lead_id=task.lead_id,
        activity_type="call_result" if task.kind == "call" else "task_done",
        description=_result_text(task, result, note), responsible_id=user_id,
    )
    db.flush()
    return task


def reschedule_task(db: Session, task: LeadTask, *, due_at: datetime, user_id: int) -> LeadTask:
    """Close as `rescheduled` and open a copy at the new time — the feed keeps the history."""
    task.status = "done"
    task.result = "rescheduled"
    task.completed_at = _now()
    task.completed_by = user_id
    new = LeadTask(lead_id=task.lead_id, kind=task.kind, due_at=due_at, assignee_id=task.assignee_id,
                   created_by=user_id, comment=task.comment, status="open")
    db.add(new)
    db.flush()
    return new


def cancel_open_tasks(db: Session, lead_id: int) -> int:
    """Lead closed (won/lost) or archived: nothing left to do on it."""
    rows = db.query(LeadTask).filter(LeadTask.lead_id == lead_id, LeadTask.status == "open").all()
    now = _now()
    for task in rows:
        task.status = "canceled"
        task.result = "auto_canceled"
        task.completed_at = now
    db.flush()
    return len(rows)


def next_tasks(db: Session, lead_ids: list[int]) -> dict[int, LeadTask]:
    if not lead_ids:
        return {}
    rows = (
        db.query(LeadTask)
        .filter(LeadTask.lead_id.in_(lead_ids), LeadTask.status == "open")
        .order_by(LeadTask.lead_id, LeadTask.due_at, LeadTask.id)
        .all()
    )
    out: dict[int, LeadTask] = {}
    for task in rows:
        out.setdefault(task.lead_id, task)
    return out


def no_answer_streaks(db: Session, lead_ids: list[int]) -> dict[int, int]:
    """Consecutive missed calls per lead (only leads with a streak > 0 are returned)."""
    if not lead_ids:
        return {}
    calls = (
        db.query(LeadTask.lead_id, LeadTask.result, LeadTask.completed_at, LeadTask.id)
        .filter(LeadTask.lead_id.in_(lead_ids), LeadTask.kind == "call",
                LeadTask.result.in_(("connected", "no_answer")))
        .all()
    )
    inbound = dict(
        db.query(WhatsAppChat.lead_id, func.max(WhatsAppMessage.sent_at))
        .join(WhatsAppMessage, WhatsAppMessage.chat_id == WhatsAppChat.id)
        .filter(WhatsAppChat.lead_id.in_(lead_ids), WhatsAppMessage.direction == "in")
        .group_by(WhatsAppChat.lead_id)
        .all()
    )
    last_connected: dict[int, tuple] = {}
    for lead_id, result, completed_at, task_id in calls:
        if result == "connected":
            key = (_aware(completed_at), task_id)
            last_connected[lead_id] = max(last_connected.get(lead_id, (_EPOCH, 0)), key)
    out: dict[int, int] = {}
    for lead_id, result, completed_at, task_id in calls:
        if result != "no_answer":
            continue
        key = (_aware(completed_at), task_id)
        if key <= last_connected.get(lead_id, (_EPOCH, 0)):
            continue
        if _aware(completed_at) <= _aware(inbound.get(lead_id)):
            continue
        out[lead_id] = out.get(lead_id, 0) + 1
    return out

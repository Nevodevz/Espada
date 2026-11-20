"""Task reminders for one user — the bell today, the Telegram bot later (one source of truth)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session, joinedload

from app.models import Lead, LeadStage, LeadStatus, LeadTask, Role, User

SOON_MINUTES = 15
BISHKEK = timezone(timedelta(hours=6))
KIND_LABELS = {"call": "Позвонить", "message": "Написать", "meeting": "Встреча", "other": "Задача"}


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _item(nid: str, severity: str, title: str, meta: str, link: str) -> dict:
    return {"id": nid, "kind": "lead_task", "severity": severity, "title": title, "meta": meta, "link": link}


def _client(task: LeadTask) -> str:
    lead = task.lead
    return (lead.client_name or lead.company_name or f"лид #{lead.id}") if lead else "лид"


def due_reminders(db: Session, user: User, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    soon_until = now + timedelta(minutes=SOON_MINUTES)
    mine = (
        db.query(LeadTask).options(joinedload(LeadTask.lead))
        .filter(LeadTask.assignee_id == user.id, LeadTask.status == "open", LeadTask.due_at < soon_until)
        .order_by(LeadTask.due_at).limit(40).all()
    )
    out: list[dict] = []
    overdue = 0
    for task in mine:
        due = _aware(task.due_at)
        label = KIND_LABELS.get(task.kind, "Задача")
        stamp = due.astimezone(BISHKEK).strftime("%d.%m %H:%M")
        if due < now:
            overdue += 1
            if overdue <= 15:
                out.append(_item(f"task_overdue_{task.id}", "warning", f"Просрочено: {label} — {_client(task)}",
                                 f"Срок был {stamp}", f"/leads/{task.lead_id}"))
        else:
            out.append(_item(f"task_soon_{task.id}", "info", f"Через {SOON_MINUTES} минут: {label} — {_client(task)}",
                             f"В {stamp}", f"/leads/{task.lead_id}"))

    # Open leads with no open task: for admins all of them, else leads where the user is setter/closer.
    closed_stage_ids = [s.id for s in db.query(LeadStage.id).filter(LeadStage.kind.in_(("won", "lost")))]
    q = db.query(Lead.id).filter(Lead.status == LeadStatus.active)
    if closed_stage_ids:
        q = q.filter((Lead.stage_id.is_(None)) | (Lead.stage_id.notin_(closed_stage_ids)))
    if not (user.role == Role.admin or user.is_founder):
        q = q.filter((Lead.setter_id == user.id) | (Lead.closer_id == user.id))
    with_task = db.query(LeadTask.lead_id).filter(LeadTask.status == "open")
    no_task = q.filter(Lead.id.notin_(with_task)).count()
    if no_task:
        out.append(_item("leads_no_task", "warning", f"Лиды без задачи: {no_task}",
                         "Поставьте следующий шаг", "/leads/board?no_task=true"))
    return out

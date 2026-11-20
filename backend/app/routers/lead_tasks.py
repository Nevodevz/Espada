"""Lead tasks API (spec 2026-11-20 §5.4)."""
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import Lead, LeadStatus, LeadTask, Role, User
from app.schemas import UserOut
from app.services import lead_tasks as svc
from app.services.whatsapp.access import can_use_whatsapp

router = APIRouter(tags=["lead-tasks"])

BISHKEK = timezone(timedelta(hours=6))


class TaskCreate(BaseModel):
    kind: Literal["call", "message", "meeting", "other"]
    due_at: datetime
    assignee_id: int | None = None
    comment: str = Field("", max_length=2000)


class TaskComplete(BaseModel):
    result: Literal["connected", "no_answer", "done"]
    note: str = Field("", max_length=2000)


class TaskReschedule(BaseModel):
    due_at: datetime


class TaskAssign(BaseModel):
    assignee_id: int


class LeadTaskOut(BaseModel):
    id: int
    lead_id: int
    lead_name: str
    kind: str
    due_at: datetime
    assignee: UserOut | None = None
    created_by_id: int | None = None
    comment: str
    status: str
    result: str | None = None
    result_note: str
    completed_at: datetime | None = None
    overdue: bool
    can_edit: bool


class CompleteOut(BaseModel):
    task: LeadTaskOut
    no_answer_streak: int
    suggest_lost: bool


def _aware(dt: datetime) -> datetime:
    """Normalise to UTC: the client sends Bishkek offsets, storage is always UTC."""
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _is_manager(user: User) -> bool:
    return user.role == Role.admin or bool(user.is_founder)


def _can_edit(db: Session, user: User, task: LeadTask) -> bool:
    if _is_manager(user) or user.id in (task.assignee_id, task.created_by):
        return True
    return task.assignee_id is None and can_use_whatsapp(db, user)


def _out(db: Session, user: User, task: LeadTask) -> LeadTaskOut:
    now = datetime.now(timezone.utc)
    lead = task.lead
    return LeadTaskOut(
        id=task.id, lead_id=task.lead_id,
        lead_name=(lead.client_name or lead.company_name or f"Лид #{lead.id}") if lead else "",
        kind=task.kind, due_at=task.due_at,
        assignee=UserOut.model_validate(task.assignee) if task.assignee else None,
        created_by_id=task.created_by, comment=task.comment, status=task.status, result=task.result,
        result_note=task.result_note, completed_at=task.completed_at,
        overdue=task.status == "open" and _aware(task.due_at) < now,
        can_edit=_can_edit(db, user, task),
    )


def _require_sales(db: Session, user: User) -> None:
    if not can_use_whatsapp(db, user):
        raise HTTPException(403, "Задачи по лидам доступны отделу продаж")


def _lead(db: Session, lead_id: int) -> Lead:
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(404, "Лид не найден")
    return lead


def _task_for_edit(db: Session, user: User, task_id: int) -> LeadTask:
    task = db.get(LeadTask, task_id)
    if task is None:
        raise HTTPException(404, "Задача не найдена")
    if not _can_edit(db, user, task):
        raise HTTPException(403, "Это не ваша задача")
    if task.status != "open":
        raise HTTPException(409, "Задача уже закрыта")
    return task


def _check_assignee(db: Session, assignee_id: int) -> None:
    assignee = db.get(User, assignee_id)
    if assignee is None or not assignee.is_active or not can_use_whatsapp(db, assignee):
        raise HTTPException(422, "Ответственным может быть только сотрудник отдела продаж")


def _query(db: Session):
    return db.query(LeadTask).options(joinedload(LeadTask.lead), joinedload(LeadTask.assignee))


@router.get("/api/leads/{lead_id}/tasks", response_model=list[LeadTaskOut])
def lead_tasks(lead_id: int, status: Literal["open", "all"] = "open",
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _lead(db, lead_id)
    q = _query(db).filter(LeadTask.lead_id == lead_id)
    if status == "open":
        q = q.filter(LeadTask.status == "open").order_by(LeadTask.due_at, LeadTask.id)
    else:
        q = q.order_by(LeadTask.created_at.desc(), LeadTask.id.desc())
    return [_out(db, user, t) for t in q.all()]


@router.post("/api/leads/{lead_id}/tasks", response_model=LeadTaskOut, status_code=201)
def create_task(lead_id: int, body: TaskCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require_sales(db, user)
    lead = _lead(db, lead_id)
    stage_kind = lead.stage.kind if lead.stage else "generic"
    if lead.status != LeadStatus.active or stage_kind in ("won", "lost"):
        # Closed/archived leads auto-cancel their tasks; a new one would just hang in «Мои задачи».
        raise HTTPException(409, "Лид закрыт или в архиве — верните его в работу, чтобы ставить задачи")
    assignee_id = body.assignee_id or user.id
    if assignee_id != user.id:
        _check_assignee(db, assignee_id)
    task = svc.create_task(db, lead, kind=body.kind, due_at=_aware(body.due_at), assignee_id=assignee_id,
                           created_by=user.id, comment=body.comment.strip())
    db.commit()
    return _out(db, user, _query(db).filter(LeadTask.id == task.id).one())


@router.post("/api/lead-tasks/{task_id}/complete", response_model=CompleteOut)
def complete(task_id: int, body: TaskComplete, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task_for_edit(db, user, task_id)
    svc.complete_task(db, task, result=body.result, note=body.note.strip(), user_id=user.id)
    db.commit()
    streak = svc.no_answer_streaks(db, [task.lead_id]).get(task.lead_id, 0)
    return CompleteOut(task=_out(db, user, task), no_answer_streak=streak,
                       suggest_lost=streak >= svc.NO_ANSWER_LOST_THRESHOLD)


@router.post("/api/lead-tasks/{task_id}/reschedule", response_model=LeadTaskOut)
def reschedule(task_id: int, body: TaskReschedule, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task_for_edit(db, user, task_id)
    new = svc.reschedule_task(db, task, due_at=_aware(body.due_at), user_id=user.id)
    db.commit()
    return _out(db, user, _query(db).filter(LeadTask.id == new.id).one())


@router.post("/api/lead-tasks/{task_id}/assign", response_model=LeadTaskOut)
def assign(task_id: int, body: TaskAssign, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Reassign — also how tasks without an assignee (left employee, migration) get an owner."""
    task = _task_for_edit(db, user, task_id)
    _check_assignee(db, body.assignee_id)
    task.assignee_id = body.assignee_id
    db.commit()
    return _out(db, user, _query(db).filter(LeadTask.id == task.id).one())


@router.post("/api/lead-tasks/{task_id}/cancel", response_model=LeadTaskOut)
def cancel(task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task_for_edit(db, user, task_id)
    task.status = "canceled"
    task.completed_at = datetime.now(timezone.utc)
    task.completed_by = user.id
    db.commit()
    return _out(db, user, task)


@router.get("/api/lead-tasks", response_model=list[LeadTaskOut])
def my_tasks(
    scope: Literal["overdue", "today", "upcoming", "all"] = "all",
    assignee: str = Query("me"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = _query(db).filter(LeadTask.status == "open")
    if not _is_manager(user) or assignee == "me":
        q = q.filter(LeadTask.assignee_id == user.id)
    elif assignee == "none":
        q = q.filter(LeadTask.assignee_id.is_(None))
    elif assignee != "all":
        try:
            q = q.filter(LeadTask.assignee_id == int(assignee))
        except ValueError:
            raise HTTPException(422, "assignee: me | none | all | <id>")
    now = datetime.now(timezone.utc)
    end_of_today = (datetime.now(BISHKEK).replace(hour=0, minute=0, second=0, microsecond=0)
                    + timedelta(days=1)).astimezone(timezone.utc)
    if scope == "overdue":
        q = q.filter(LeadTask.due_at < now)
    elif scope == "today":
        q = q.filter(LeadTask.due_at >= now, LeadTask.due_at < end_of_today)
    elif scope == "upcoming":
        q = q.filter(LeadTask.due_at >= end_of_today)
    return [_out(db, user, t) for t in q.order_by(LeadTask.due_at, LeadTask.id).limit(500).all()]

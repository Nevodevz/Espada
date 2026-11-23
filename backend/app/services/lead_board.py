"""Ordering of cards on the sales board.

All sorting goes through `board_sort_key` so later features (lead tasks,
unread WhatsApp messages) extend one function instead of every caller.
"""
from datetime import datetime, timezone

from app.models import Lead

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _ts(value: datetime | None) -> float:
    if value is None:
        return _EPOCH.timestamp()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def board_sort_key(lead: Lead, unread: int = 0, next_task=None) -> tuple:
    """Unread WhatsApp → overdue task → no task → the rest; then most recently active.

    `next_task` is the lead's nearest open task (anything with `.overdue`), or None.
    """
    if next_task is None:
        task_rank = 1
    else:
        task_rank = 0 if next_task.overdue else 2
    return (0 if unread else 1, task_rank, -_ts(lead.updated_at or lead.created_at), -lead.id)


CLOSED_KINDS = ("won", "lost")


def apply_board_toggles(db, query, user, *, mine: bool = False, unassigned: bool = False,
                        show_closed: bool = True):
    """SQL-level quick toggles shared by the board and the list view."""
    from sqlalchemy import or_

    from app.models import LeadStage

    if mine:
        query = query.filter(or_(Lead.setter_id == user.id, Lead.closer_id == user.id))
    if unassigned:
        query = query.filter(Lead.setter_id.is_(None))
    if not show_closed:
        closed_ids = [s.id for s in db.query(LeadStage.id).filter(LeadStage.kind.in_(CLOSED_KINDS))]
        if closed_ids:
            query = query.filter(or_(Lead.stage_id.is_(None), Lead.stage_id.notin_(closed_ids)))
    return query


def task_state_matches(lead_id: int, next_tasks: dict, *, overdue: bool = False, no_task: bool = False) -> bool:
    """Task-based toggles; `next_tasks` maps lead id → nearest open task (with `.overdue`)."""
    task = next_tasks.get(lead_id)
    if overdue and not (task is not None and task.overdue):
        return False
    if no_task and task is not None:
        return False
    return True

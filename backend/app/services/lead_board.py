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

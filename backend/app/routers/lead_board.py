"""Sales board: one column per funnel stage, cards are open leads.

Moving a card is a stage change and goes through `PATCH /api/leads/{id}/stage`,
so every stage side effect (meeting, deal, payment schedule) applies.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models import Lead, LeadStage, LeadStatus, Meeting, MeetingStatus, User
from app.routers.leads import LeadOut, _apply_list_filters, _deals_by_lead, _eager_lead, _lead_out
from app.services.lead_board import board_sort_key
from app.services.leads import active_stages

router = APIRouter(prefix="/api/lead-board", tags=["lead-board"])

CLOSED_KINDS = ("won", "lost")


class StageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    color: str
    position: int
    kind: str


class ScheduledMeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    meeting_date: datetime
    duration_minutes: int
    closer_id: int | None
    address: str


class CardOut(LeadOut):
    scheduled_meeting: ScheduledMeetingOut | None = None


class BoardOut(BaseModel):
    stages: list[StageOut]
    leads: list[CardOut]


def _scheduled_meetings(db: Session, lead_ids: list[int]) -> dict[int, Meeting]:
    """Open meeting per lead in one query — same rule as `scheduled_meeting_for`."""
    if not lead_ids:
        return {}
    rows = (
        db.query(Meeting)
        .filter(
            Meeting.lead_id.in_(lead_ids),
            Meeting.status == MeetingStatus.scheduled,
            Meeting.parent_id.is_(None),
        )
        .order_by(Meeting.meeting_date.desc(), Meeting.id.desc())
        .all()
    )
    out: dict[int, Meeting] = {}
    for m in rows:
        out.setdefault(m.lead_id, m)
    return out


@router.get("", response_model=BoardOut)
def get_board(
    search: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    source_id: int | None = None,
    service_id: int | None = None,
    stage_id: int | None = None,
    setter_id: int | None = None,
    closer_id: int | None = None,
    mine: bool = False,
    unassigned: bool = False,
    show_closed: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = _apply_list_filters(
        _eager_lead(db), source_id=source_id, service_id=service_id, stage_id=stage_id,
        setter_id=setter_id, closer_id=closer_id, search=search,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
    ).filter(Lead.status == LeadStatus.active)
    if mine:
        query = query.filter(or_(Lead.setter_id == user.id, Lead.closer_id == user.id))
    if unassigned:
        query = query.filter(Lead.setter_id.is_(None))
    if not show_closed:
        closed_ids = [s.id for s in db.query(LeadStage.id).filter(LeadStage.kind.in_(CLOSED_KINDS))]
        if closed_ids:
            query = query.filter(or_(Lead.stage_id.is_(None), Lead.stage_id.notin_(closed_ids)))

    leads = sorted(query.all(), key=board_sort_key)
    deals = _deals_by_lead(db, [lead.id for lead in leads])
    meetings = _scheduled_meetings(db, [lead.id for lead in leads])
    cards = []
    for lead in leads:
        meeting = meetings.get(lead.id)
        cards.append(CardOut(
            **_lead_out(db, lead, deals.get(lead.id)).model_dump(),
            scheduled_meeting=ScheduledMeetingOut.model_validate(meeting) if meeting else None,
        ))
    return BoardOut(stages=[StageOut.model_validate(s) for s in active_stages(db)], leads=cards)
